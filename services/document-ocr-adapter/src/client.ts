import { OcrAdapterError } from "./errors.js";
import { validatePdfUpload } from "./fileValidation.js";
import { parseBackendResult } from "./normalize.js";
import {
  analysisResponseSchema,
  formatsResponseSchema,
  healthResponseSchema,
  jobStatusSchema,
  jobSubmitResponseSchema,
  type JobStatus,
  type NormalizedOcrDocument
} from "./schemas.js";

export interface OcrUpload {
  fileName: string;
  mimeType: "application/pdf";
  bytes: Uint8Array;
}

export interface OcrClientOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  pollIntervalMs?: number;
  retries?: number;
}

export class OcrBackendClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly retries: number;

  constructor(options: OcrClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.retries = options.retries ?? 1;
  }

  async assertIdentity(signal?: AbortSignal): Promise<void> {
    const init = signal ? { signal } : {};
    const [healthResponse, formatsResponse] = await Promise.all([
      this.request("/health", init, true),
      this.request("/formats", init, true)
    ]);
    const health = healthResponseSchema.safeParse(await healthResponse.json());
    const formats = formatsResponseSchema.safeParse(await formatsResponse.json());
    if (
      !health.success ||
      !formats.success ||
      !health.data.version.startsWith("2.") ||
      health.data.primary_engine !== "pymupdf" ||
      !health.data.yomitoku_available ||
      !health.data.ocr_backend_available ||
      !formats.data.input_formats.includes("pdf") ||
      !formats.data.output_formats.includes("json")
    ) {
      throw new OcrAdapterError(
        "wrong_backend",
        "Endpoint is not the expected PolicyGOS Document OCR API"
      );
    }
  }

  async analyzeSync(upload: OcrUpload, signal?: AbortSignal): Promise<NormalizedOcrDocument> {
    validatePdfUpload(upload.fileName, upload.mimeType, upload.bytes);
    await this.assertIdentity(signal);
    const formData = this.toFormData(upload);
    const response = await this.request(
      "/analyze?output_format=json",
      { method: "POST", body: formData, ...(signal ? { signal } : {}) },
      false
    );
    const payload = analysisResponseSchema.safeParse(await response.json());
    if (!payload.success) {
      throw new OcrAdapterError("invalid_response", "Invalid OCR analysis response");
    }
    if (!payload.data.success || payload.data.result === null) {
      throw new OcrAdapterError(
        "backend",
        payload.data.error ?? "OCR analysis failed"
      );
    }
    return parseBackendResult(payload.data.result);
  }

  async submit(upload: OcrUpload, signal?: AbortSignal): Promise<string> {
    validatePdfUpload(upload.fileName, upload.mimeType, upload.bytes);
    await this.assertIdentity(signal);
    const response = await this.request(
      "/analyze/async?output_format=json",
      {
        method: "POST",
        body: this.toFormData(upload),
        ...(signal ? { signal } : {})
      },
      false
    );
    const payload = jobSubmitResponseSchema.safeParse(await response.json());
    if (!payload.success) {
      throw new OcrAdapterError("invalid_response", "Invalid OCR job response");
    }
    return payload.data.job_id;
  }

  async getJob(jobId: string, signal?: AbortSignal): Promise<JobStatus> {
    const response = await this.request(
      `/jobs/${encodeURIComponent(jobId)}`,
      signal ? { signal } : {},
      true
    );
    const payload = jobStatusSchema.safeParse(await response.json());
    if (!payload.success) {
      throw new OcrAdapterError("invalid_response", "Invalid OCR job status response");
    }
    return payload.data;
  }

  async waitForJob(jobId: string, signal?: AbortSignal): Promise<NormalizedOcrDocument> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < this.timeoutMs) {
      if (signal?.aborted) {
        throw new OcrAdapterError("cancelled", "OCR job wait was cancelled");
      }
      const job = await this.getJob(jobId, signal);
      if (job.status === "completed" && job.result) {
        return parseBackendResult(job.result);
      }
      if (job.status === "failed") {
        throw new OcrAdapterError("backend", job.error ?? "OCR job failed");
      }
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.pollIntervalMs);
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new OcrAdapterError("cancelled", "OCR job wait was cancelled"));
          },
          { once: true }
        );
      });
    }
    throw new OcrAdapterError("timeout", `OCR job ${jobId} timed out`);
  }

  async cancel(jobId: string, signal?: AbortSignal): Promise<void> {
    await this.request(
      `/jobs/${encodeURIComponent(jobId)}`,
      { method: "DELETE", ...(signal ? { signal } : {}) },
      false
    );
  }

  private toFormData(upload: OcrUpload): FormData {
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([new Uint8Array(upload.bytes).buffer], { type: upload.mimeType }),
      upload.fileName
    );
    return formData;
  }

  private async request(
    path: string,
    init: RequestInit,
    retryable: boolean
  ): Promise<Response> {
    const attempts = retryable ? this.retries + 1 : 1;
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
        if (!response.ok) {
          throw new OcrAdapterError(
            "backend",
            `OCR backend returned HTTP ${response.status}`
          );
        }
        return response;
      } catch (error) {
        if (error instanceof OcrAdapterError) {
          lastError = error;
        } else if (init.signal?.aborted) {
          throw new OcrAdapterError("cancelled", "OCR request was cancelled", {
            cause: error
          });
        } else {
          lastError = new OcrAdapterError("network", "OCR backend request failed", {
            cause: error
          });
        }
      }
    }
    throw lastError;
  }
}
