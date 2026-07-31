import { z } from "zod";
import { ReportMetaError } from "../errors.js";
import { parseJsonText, postJson } from "../http.js";
import type {
  ReportMetaProvider,
  StructuredOutputRequest,
  StructuredOutputResult
} from "../types.js";

const geminiResponseSchema = z
  .object({
    candidates: z.array(
      z
        .object({
          finishReason: z.string().optional(),
          content: z.object({
            parts: z.array(z.object({ text: z.string().optional() }).passthrough())
          })
        })
        .passthrough()
    ),
    usageMetadata: z
      .object({
        promptTokenCount: z.number().optional(),
        candidatesTokenCount: z.number().optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough();

export interface GeminiProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export class GeminiStructuredOutputProvider implements ReportMetaProvider {
  readonly name = "gemini";
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly baseUrl: string;

  constructor(private readonly options: GeminiProviderOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.baseUrl = (
      options.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta"
    ).replace(/\/+$/, "");
  }

  async generate(request: StructuredOutputRequest): Promise<StructuredOutputResult> {
    const raw = await postJson(
      this.fetchImpl,
      `${this.baseUrl}/models/${encodeURIComponent(this.options.model)}:generateContent`,
      { "x-goog-api-key": this.options.apiKey },
      {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: "user", parts: [{ text: request.prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: request.jsonSchema
        }
      },
      request.signal
    );
    const response = geminiResponseSchema.safeParse(raw);
    const candidate = response.success ? response.data.candidates[0] : undefined;
    if (!response.success || !candidate) {
      throw new ReportMetaError(
        "provider_response",
        "Gemini returned no extraction candidate"
      );
    }
    if (candidate.finishReason && candidate.finishReason !== "STOP") {
      throw new ReportMetaError(
        candidate.finishReason === "SAFETY"
          ? "provider_refusal"
          : "provider_response",
        `Gemini extraction ended with ${candidate.finishReason}`
      );
    }
    const text = candidate.content.parts.map((part) => part.text ?? "").join("");
    if (!text) {
      throw new ReportMetaError("provider_response", "Gemini returned no content");
    }
    return {
      value: parseJsonText(text),
      model: this.options.model,
      ...(response.data.usageMetadata?.promptTokenCount !== undefined
        ? { inputTokens: response.data.usageMetadata.promptTokenCount }
        : {}),
      ...(response.data.usageMetadata?.candidatesTokenCount !== undefined
        ? { outputTokens: response.data.usageMetadata.candidatesTokenCount }
        : {}),
      finishReason: candidate.finishReason ?? "STOP"
    };
  }
}
