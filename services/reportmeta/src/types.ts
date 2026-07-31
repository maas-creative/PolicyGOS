import type { NormalizedOcrDocument } from "@policygos/document-ocr-adapter";
import type { PolicyDataset } from "@policygos/policy-schema";

export interface ReportMetaDocument {
  documentId: string;
  fileName: string;
  ocr: NormalizedOcrDocument;
}

export interface ReportMetaExtractionRequest {
  documents: ReportMetaDocument[];
  municipalityHint?: string;
  titleHint?: string;
  signal?: AbortSignal;
}

export interface StructuredOutputRequest {
  system: string;
  prompt: string;
  jsonSchema: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface StructuredOutputResult {
  value: unknown;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
  finishReason: string;
}

export interface ReportMetaProvider {
  readonly name: string;
  generate(request: StructuredOutputRequest): Promise<StructuredOutputResult>;
}

export interface ReportMetaExtractionResult {
  dataset: PolicyDataset;
  provider: {
    name: string;
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    cost: number | null;
    durationMs: number;
    finishReason: string;
  };
}
