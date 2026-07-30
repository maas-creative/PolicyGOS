import {
  policyDatasetCandidateSchema,
  policyDatasetJsonSchema,
  safeParsePolicyDataset
} from "@policygos/policy-schema";
import { ReportMetaError } from "./errors.js";
import { groundPolicyDataset } from "./ground.js";
import { buildReportMetaPrompt, REPORTMETA_SYSTEM_INSTRUCTION } from "./prompt.js";
import { repairCandidateReferences } from "./repair.js";
import { addDerivedReviewItems } from "./review.js";
import type {
  ReportMetaExtractionRequest,
  ReportMetaExtractionResult,
  ReportMetaProvider
} from "./types.js";

export async function extractPolicyDataset(
  request: ReportMetaExtractionRequest,
  provider: ReportMetaProvider
): Promise<ReportMetaExtractionResult> {
  if (request.documents.length === 0) {
    throw new ReportMetaError(
      "invalid_request",
      "At least one OCR document is required"
    );
  }
  const startedAt = performance.now();
  const output = await provider.generate({
    system: REPORTMETA_SYSTEM_INSTRUCTION,
    prompt: buildReportMetaPrompt(request),
    jsonSchema: policyDatasetJsonSchema(),
    ...(request.signal ? { signal: request.signal } : {})
  });
  const candidate = policyDatasetCandidateSchema.safeParse(output.value);
  if (!candidate.success) {
    throw new ReportMetaError(
      "schema_validation",
      `Provider output failed PolicyDataset validation: ${candidate.error.message}`,
      { cause: candidate.error }
    );
  }
  const parsed = safeParsePolicyDataset(
    repairCandidateReferences(candidate.data, request)
  );
  if (!parsed.success) {
    throw new ReportMetaError(
      "schema_validation",
      `Provider output failed PolicyDataset reference validation: ${parsed.error.message}`,
      { cause: parsed.error }
    );
  }
  const requestedDocumentIds = new Set(
    request.documents.map(({ documentId }) => documentId)
  );
  const returnedDocumentIds = new Set(
    parsed.data.documents.map(({ id }) => id)
  );
  const missingDocumentIds = [...requestedDocumentIds].filter(
    (id) => !returnedDocumentIds.has(id)
  );
  const unknownDocumentIds = [...returnedDocumentIds].filter(
    (id) => !requestedDocumentIds.has(id)
  );
  if (missingDocumentIds.length > 0 || unknownDocumentIds.length > 0) {
    throw new ReportMetaError(
      "schema_validation",
      `Provider changed document identity (missing: ${missingDocumentIds.join(", ") || "none"}; unknown: ${unknownDocumentIds.join(", ") || "none"})`
    );
  }
  const dataset = addDerivedReviewItems(
    groundPolicyDataset(parsed.data, request)
  );
  return {
    dataset,
    provider: {
      name: provider.name,
      model: output.model,
      ...(output.inputTokens !== undefined
        ? { inputTokens: output.inputTokens }
        : {}),
      ...(output.outputTokens !== undefined
        ? { outputTokens: output.outputTokens }
        : {}),
      ...(output.cost !== undefined ? { cost: output.cost } : {}),
      durationMs: Math.round(performance.now() - startedAt),
      finishReason: output.finishReason
    }
  };
}
