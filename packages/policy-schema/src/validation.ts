import { z } from "zod";
import {
  POLICY_DATASET_SCHEMA_VERSION,
  policyDatasetSchema,
  type PolicyDataset
} from "./schema.js";

export function parsePolicyDataset(input: unknown): PolicyDataset {
  return policyDatasetSchema.parse(input);
}

export function safeParsePolicyDataset(input: unknown) {
  return policyDatasetSchema.safeParse(input);
}

export function policyDatasetJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(policyDatasetSchema, {
    target: "draft-2020-12",
    reused: "ref"
  }) as Record<string, unknown>;
}

export function migratePolicyDataset(input: unknown): PolicyDataset {
  if (
    typeof input !== "object" ||
    input === null ||
    !("schemaVersion" in input)
  ) {
    throw new Error("PolicyDataset schemaVersion is required");
  }
  if (input.schemaVersion !== POLICY_DATASET_SCHEMA_VERSION) {
    throw new Error(`Unsupported PolicyDataset version: ${String(input.schemaVersion)}`);
  }
  return parsePolicyDataset(input);
}
