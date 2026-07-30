import { describe, expect, it } from "vitest";
import {
  POLICY_OPENUI_COMPONENT_NAMES,
  policyOpenUiSystemPrompt,
  validatePolicyOpenUiResponse
} from "./library.js";

const validResponse = `root = PolicySummary(null, "project-1", [comparison, quote])
comparison = MetricComparison("indicator-1", ["metric-target", "metric-actual"])
quote = EvidenceQuote(["evidence-target", "evidence-actual"])`;

describe("PolicyGOS OpenUI library", () => {
  it("contains only the allowlisted project components", () => {
    expect(POLICY_OPENUI_COMPONENT_NAMES).toHaveLength(10);
    expect(policyOpenUiSystemPrompt).toContain("PolicySummary");
  });

  it("accepts a valid ID-bound response", () => {
    const validation = validatePolicyOpenUiResponse(validResponse);
    expect(validation.valid).toBe(true);
  });

  it("rejects unknown components even though OpenUI parser is permissive", () => {
    const validation = validatePolicyOpenUiResponse(
      'root = ArbitraryHtml("<script>alert(1)</script>")'
    );
    expect(validation.valid).toBe(false);
    expect(validation.result.meta.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unknown-component" })
      ])
    );
  });

  it("rejects unresolved references after streaming completes", () => {
    const validation = validatePolicyOpenUiResponse(
      'root = PolicySummary(null, "project-1", [missing])'
    );
    expect(validation.valid).toBe(false);
    expect(validation.result.meta.unresolved).toContain("missing");
  });
});
