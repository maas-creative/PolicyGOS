import { buildPolicyDatasetFixture } from "@policygos/policy-schema";
import { describe, expect, it, vi } from "vitest";
import { readServerConfig } from "./config.js";
import { requestOpenUiProgram } from "./openui.js";

describe("OpenUI provider adapter", () => {
  it("requests bounded structured output from the dedicated model", async () => {
    const program =
      'root = PolicySummary(null, "project-1", [comparison])\n' +
      'comparison = MetricComparison("indicator-1", ["metric-target"])';
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              content: "",
              reasoning_content: JSON.stringify({ program })
            }
          }
        ]
      })
    );
    const config = readServerConfig({
      OPENAI_MODEL: "extractor",
      OPENUI_MODEL: "composer"
    });

    await expect(
      requestOpenUiProgram(
        {
          dataset: buildPolicyDatasetFixture(),
          question: "説明してください",
          audience: "resident"
        },
        config,
        new AbortController().signal,
        fetchMock
      )
    ).resolves.toBe(program);

    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      stream: boolean;
      max_tokens: number;
      response_format: {
        type: string;
        json_schema: { strict: boolean };
      };
    };
    expect(body).toMatchObject({
      model: "composer",
      stream: false,
      max_tokens: 768,
      response_format: {
        type: "json_schema",
        json_schema: { strict: true }
      }
    });
  });

  it("rejects an incomplete program inside valid JSON", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                program:
                  'root = PolicySummary(null, "project-1", [comparison])'
              })
            }
          }
        ]
      })
    );
    await expect(
      requestOpenUiProgram(
        {
          dataset: buildPolicyDatasetFixture(),
          question: "説明してください",
          audience: "resident"
        },
        readServerConfig({}),
        new AbortController().signal,
        fetchMock
      )
    ).rejects.toThrow("invalid or incomplete");
  });
});
