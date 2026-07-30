import { describe, expect, it, vi } from "vitest";
import { pipeOpenAiSse } from "./openui.js";

describe("OpenUI SSE adapter", () => {
  it("uses reasoning_content when a local reasoning model leaves content empty", async () => {
    const dsl = 'root = PolicySummary(null, "project-1", [])';
    const sse = [
      `data: ${JSON.stringify({
        choices: [{ delta: { reasoning_content: dsl } }]
      })}`,
      "data: [DONE]",
      ""
    ].join("\n\n");
    const response = new Response(sse, {
      headers: { "Content-Type": "text/event-stream" }
    });
    const write = vi.fn().mockResolvedValue(undefined);
    await expect(pipeOpenAiSse(response, write)).resolves.toBe(dsl);
    expect(write).toHaveBeenCalledWith(dsl);
  });
});
