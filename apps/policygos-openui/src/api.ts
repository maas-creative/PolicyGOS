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

export async function analyzePdf(
  file: File,
  signal?: AbortSignal
): Promise<NormalizedOcrDocument> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/ocr/analyze", {
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
  const response = await fetch("/api/reportmeta/extract", {
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
  const response = await fetch("/api/openui/generate", {
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

async function readJsonResponse(response: Response): Promise<unknown> {
  const body = (await response.json()) as { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with HTTP ${response.status}`);
  }
  return body;
}
