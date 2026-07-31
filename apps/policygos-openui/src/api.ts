import {
  normalizedOcrDocumentSchema,
  type NormalizedOcrDocument
} from "@policygos/document-ocr-adapter";
import {
  policyDatasetSchema,
  type PolicyDataset
} from "@policygos/policy-schema";
import { z } from "zod";

const extractionResponseSchema = z.object({
  dataset: policyDatasetSchema,
  provider: z.object({
    name: z.string(),
    model: z.string(),
    durationMs: z.number()
  }).passthrough()
});

const runtimeInfoSchema = z.object({
  deployment: z.enum(["local", "public"]),
  localOnly: z.boolean(),
  reportMeta: z.object({
    provider: z.enum(["local", "openai", "gemini", "ollama"]),
    model: z.string(),
    host: z.string().url()
  }),
  openUi: z.object({
    model: z.string(),
    host: z.string().url()
  }),
  ocr: z.object({
    host: z.string().url()
  }),
  retention: z.object({
    server: z.literal("request-only"),
    browser: z.literal("until-workspace-is-cleared")
  })
});

export type RuntimeInfo = z.infer<typeof runtimeInfoSchema>;

const serviceStatusSchema = z.object({
  status: z.literal("healthy"),
  service: z.literal("policygos-openui-api"),
  authRequired: z.boolean()
});

let accessToken = "";

export function setAccessToken(token: string): void {
  accessToken = token.trim();
}

export async function getServiceStatus(signal?: AbortSignal) {
  const response = await fetch("/api/health", {
    ...(signal ? { signal } : {})
  });
  return serviceStatusSchema.parse(await readJsonResponse(response));
}

export async function authenticate(token: string): Promise<{ subject: string }> {
  setAccessToken(token);
  try {
    const response = await authorizedFetch("/api/session");
    return z.object({ subject: z.string().min(1) }).parse(
      await readJsonResponse(response)
    );
  } catch (error) {
    setAccessToken("");
    throw error;
  }
}

export async function getRuntimeInfo(signal?: AbortSignal): Promise<RuntimeInfo> {
  const response = await authorizedFetch("/api/runtime", {
    ...(signal ? { signal } : {})
  });
  return runtimeInfoSchema.parse(await readJsonResponse(response));
}

export async function analyzePdf(
  file: File,
  signal?: AbortSignal
): Promise<NormalizedOcrDocument> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await authorizedFetch("/api/ocr/analyze", {
    method: "POST",
    body: formData,
    ...(signal ? { signal } : {})
  });
  return normalizedOcrDocumentSchema.parse(await readJsonResponse(response));
}

export async function extractPolicyDatasetFromOcr(
  documentId: string,
  fileName: string,
  ocr: NormalizedOcrDocument,
  signal?: AbortSignal
): Promise<PolicyDataset> {
  const response = await authorizedFetch("/api/reportmeta/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documents: [{ documentId, fileName, ocr }]
    }),
    ...(signal ? { signal } : {})
  });
  return extractionResponseSchema.parse(await readJsonResponse(response)).dataset;
}

export async function generateOpenUi(
  input: {
    dataset: PolicyDataset;
    question: string;
    audience: "resident" | "staff" | "council" | "researcher";
    previousResponse?: string;
  },
  onChunk: (accumulated: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const response = await authorizedFetch("/api/openui/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    ...(signal ? { signal } : {})
  });
  if (!response.ok || !response.body) {
    await readJsonResponse(response);
    throw new Error("OpenUI stream was unavailable");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";
  while (true) {
    const { done, value } = await reader.read();
    accumulated += decoder.decode(value, { stream: !done });
    onChunk(accumulated);
    if (done) {
      return accumulated;
    }
  }
}

function authorizedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  return fetch(input, { ...init, headers });
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const body = (await response.json()) as { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with HTTP ${response.status}`);
  }
  return body;
}
