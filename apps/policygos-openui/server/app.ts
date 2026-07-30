import { OcrBackendClient, normalizedOcrDocumentSchema } from "@policygos/document-ocr-adapter";
import { policyDatasetSchema } from "@policygos/policy-schema";
import {
  extractPolicyDataset,
  ReportMetaError
} from "@policygos/reportmeta";
import { Hono } from "hono";
import { streamText } from "hono/streaming";
import { z } from "zod";
import {
  createReportMetaProvider,
  readServerConfig,
  type ServerConfig
} from "./config.js";
import {
  requestOpenUiProgram,
  type OpenUiGenerationRequest
} from "./openui.js";

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const reportMetaRequestSchema = z.object({
  documents: z
    .array(
      z.object({
        documentId: z.string().min(1),
        fileName: z.string().min(1),
        ocr: normalizedOcrDocumentSchema
      })
    )
    .min(1),
  municipalityHint: z.string().optional(),
  titleHint: z.string().optional()
});
const openUiRequestSchema = z.object({
  dataset: policyDatasetSchema,
  question: z.string().trim().min(1).max(4000),
  audience: z.enum(["resident", "staff", "council", "researcher"]),
  previousResponse: z.string().max(100_000).optional()
});

export function createPolicyApi(
  config: ServerConfig = readServerConfig(),
  dependencies: {
    fetch?: typeof fetch;
    environment?: NodeJS.ProcessEnv;
  } = {}
) {
  const app = new Hono();
  const fetchImpl = dependencies.fetch ?? fetch;
  const environment = dependencies.environment ?? process.env;

  app.get("/api/health", (context) =>
    context.json({
      status: "healthy",
      service: "policygos-openui-api",
      localOnly: config.localOnly,
      reportMeta: {
        provider: config.reportMetaProvider,
        model: config.reportMetaModel,
        host: config.reportMetaProviderHost
      },
      openUi: {
        model: config.openUiModel,
        host: new URL(config.openAiBaseUrl).origin
      },
      ocr: {
        host: new URL(config.ocrBackendUrl).origin
      },
      retention: {
        server: "request-only",
        browser: "until-workspace-is-cleared"
      }
    })
  );

  app.post("/api/ocr/analyze", async (context) => {
    const form = await context.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return context.json({ error: "PDF file is required" }, 400);
    }
    if (file.size > MAX_PDF_BYTES) {
      return context.json({ error: "PDF exceeds the 50MB limit" }, 413);
    }
    const client = new OcrBackendClient({
      baseUrl: config.ocrBackendUrl,
      fetch: fetchImpl
    });
    const result = await client.analyzeSync(
      {
        fileName: file.name,
        mimeType: "application/pdf",
        bytes: new Uint8Array(await file.arrayBuffer())
      },
      context.req.raw.signal
    );
    return context.json(result);
  });

  app.post("/api/reportmeta/extract", async (context) => {
    const request = reportMetaRequestSchema.parse(await context.req.json());
    const provider = createReportMetaProvider(environment);
    const result = await extractPolicyDataset(
      {
        documents: request.documents,
        ...(request.municipalityHint
          ? { municipalityHint: request.municipalityHint }
          : {}),
        ...(request.titleHint ? { titleHint: request.titleHint } : {}),
        signal: context.req.raw.signal
      },
      provider
    );
    return context.json(result);
  });

  app.post("/api/openui/generate", async (context) => {
    const request = openUiRequestSchema.parse(
      await context.req.json()
    ) as OpenUiGenerationRequest;
    const publishableValues = request.dataset.indicators.flatMap(
      ({ values }) =>
        values.filter(({ reviewStatus, evidenceIds }) =>
          ["confirmed", "corrected"].includes(reviewStatus) &&
          evidenceIds.length > 0
        )
    );
    if (publishableValues.length === 0) {
      return context.json(
        { error: "No confirmed or corrected values are available" },
        409
      );
    }
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 120_000);
    let program: string;
    try {
      program = await requestOpenUiProgram(
        request,
        config,
        controller.signal,
        fetchImpl
      );
    } catch (error) {
      if (timedOut) {
        throw new Error("OpenUI generation timed out after 120 seconds");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    return streamText(context, async (stream) => {
      for (const line of program.match(/[^\n]*\n|[^\n]+$/g) ?? [program]) {
        await stream.write(line);
      }
    });
  });

  app.onError((error, context) => {
    const status =
      error instanceof z.ZodError
        ? 400
        : error instanceof ReportMetaError
          ? 422
          : 502;
    return context.json(
      {
        error: error.message,
        ...(error instanceof ReportMetaError ? { code: error.code } : {})
      },
      status
    );
  });

  return app;
}
