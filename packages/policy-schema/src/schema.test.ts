import { describe, expect, it } from "vitest";
import { buildPolicyDatasetFixture } from "./fixtures.js";
import {
  migratePolicyDataset,
  policyDatasetJsonSchema,
  safeParsePolicyDataset
} from "./validation.js";

describe("PolicyDataset v1", () => {
  it("accepts a valid fixture", () => {
    expect(safeParsePolicyDataset(buildPolicyDatasetFixture()).success).toBe(true);
  });

  it.each([
    ["unknown document", (fixture: ReturnType<typeof buildPolicyDatasetFixture>) => {
      fixture.evidence[0]!.documentId = "missing";
    }],
    ["unknown evidence", (fixture: ReturnType<typeof buildPolicyDatasetFixture>) => {
      fixture.projects[0]!.evidenceIds = ["missing"];
    }],
    ["duplicate ID", (fixture: ReturnType<typeof buildPolicyDatasetFixture>) => {
      fixture.evidence[1]!.id = fixture.evidence[0]!.id;
    }],
    ["confirmed value without evidence", (fixture: ReturnType<typeof buildPolicyDatasetFixture>) => {
      fixture.indicators[0]!.values[0]!.evidenceIds = [];
    }]
  ])("rejects %s", (_name, mutate) => {
    const fixture = buildPolicyDatasetFixture();
    mutate(fixture);
    expect(safeParsePolicyDataset(fixture).success).toBe(false);
  });

  it("exports JSON Schema from the same Zod schema", () => {
    const schema = policyDatasetJsonSchema();
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(JSON.stringify(schema)).toContain("policy-dataset-v1");
  });

  it("fails closed for unsupported versions", () => {
    const fixture = { ...buildPolicyDatasetFixture(), schemaVersion: "future-v2" };
    expect(() => migratePolicyDataset(fixture)).toThrow(
      "Unsupported PolicyDataset version"
    );
  });
});
