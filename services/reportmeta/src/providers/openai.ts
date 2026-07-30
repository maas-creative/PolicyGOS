import { z } from "zod";
import { ReportMetaError } from "../errors.js";
import { parseJsonText, postJson } from "../http.js";
import type {
  ReportMetaProvider,
  StructuredOutputRequest,
  StructuredOutputResult
} from "../types.js";

const responsesApiSchema = z
  .object({
    status: z.string(),
    model: z.string(),
    output: z.array(
      z
        .object({
          type: z.string(),
          content: z
            .array(
              z
                .object({
                  type: z.string(),
                  text: z.string().optional(),
                  refusal: z.string().optional()
                })
                .passthrough()
            )
            .optional()
        })
        .passthrough()
    ),
    usage: z
      .object({
        input_tokens: z.number().optional(),
        output_tokens: z.number().optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough();

const chatCompletionsSchema = z
  .object({
    model: z.string(),
    choices: z.array(
      z
        .object({
          finish_reason: z.string().nullable(),
          message: z
            .object({
              content: z.string().nullable(),
              reasoning_content: z.string().nullable().optional(),
              refusal: z.string().nullable().optional()
            })
            .passthrough()
        })
        .passthrough()
    ),
    usage: z
      .object({
        prompt_tokens: z.number().optional(),
        completion_tokens: z.number().optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough();

export interface OpenAiProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  api?: "responses" | "chat-completions";
  fetch?: typeof globalThis.fetch;
}

export class OpenAiStructuredOutputProvider implements ReportMetaProvider {
  readonly name = "openai-compatible";
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly api: "responses" | "chat-completions";

  constructor(private readonly options: OpenAiProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.api = options.api ?? "responses";
  }

  async generate(request: StructuredOutputRequest): Promise<StructuredOutputResult> {
    return this.api === "responses"
      ? this.generateWithResponses(request)
      : this.generateWithChatCompletions(request);
  }

  private async generateWithResponses(
    request: StructuredOutputRequest
  ): Promise<StructuredOutputResult> {
    const raw = await postJson(
      this.fetchImpl,
      `${this.baseUrl}/responses`,
      { Authorization: `Bearer ${this.options.apiKey}` },
      {
        model: this.options.model,
        instructions: request.system,
        input: request.prompt,
        text: {
          format: {
            type: "json_schema",
            name: "policy_dataset",
            strict: true,
            schema: request.jsonSchema
          }
        }
      },
      request.signal
    );
    const response = responsesApiSchema.safeParse(raw);
    if (!response.success || response.data.status !== "completed") {
      throw new ReportMetaError("provider_response", "OpenAI response was incomplete");
    }
    const content = response.data.output.flatMap((item) => item.content ?? []);
    const refusal = content.find((item) => item.type === "refusal");
    if (refusal) {
      throw new ReportMetaError(
        "provider_refusal",
        refusal.refusal ?? "OpenAI refused the extraction request"
      );
    }
    const outputText = content.find((item) => item.type === "output_text")?.text;
    if (!outputText) {
      throw new ReportMetaError("provider_response", "OpenAI returned no output text");
    }
    return {
      value: parseJsonText(outputText),
      model: response.data.model,
      ...(response.data.usage?.input_tokens !== undefined
        ? { inputTokens: response.data.usage.input_tokens }
        : {}),
      ...(response.data.usage?.output_tokens !== undefined
        ? { outputTokens: response.data.usage.output_tokens }
        : {}),
      finishReason: response.data.status
    };
  }

  private async generateWithChatCompletions(
    request: StructuredOutputRequest
  ): Promise<StructuredOutputResult> {
    const raw = await postJson(
      this.fetchImpl,
      `${this.baseUrl}/chat/completions`,
      { Authorization: `Bearer ${this.options.apiKey}` },
      {
        model: this.options.model,
        temperature: 0,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.prompt }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "policy_dataset",
            strict: true,
            schema: request.jsonSchema
          }
        }
      },
      request.signal
    );
    const response = chatCompletionsSchema.safeParse(raw);
    const choice = response.success ? response.data.choices[0] : undefined;
    if (!response.success || !choice) {
      throw new ReportMetaError(
        "provider_response",
        "OpenAI-compatible API returned an invalid response"
      );
    }
    if (choice.message.refusal) {
      throw new ReportMetaError("provider_refusal", choice.message.refusal);
    }
    const structuredContent =
      choice.message.content || choice.message.reasoning_content;
    if (!structuredContent) {
      throw new ReportMetaError(
        "provider_response",
        "OpenAI-compatible API returned no content"
      );
    }
    return {
      value: parseJsonText(structuredContent),
      model: response.data.model,
      ...(response.data.usage?.prompt_tokens !== undefined
        ? { inputTokens: response.data.usage.prompt_tokens }
        : {}),
      ...(response.data.usage?.completion_tokens !== undefined
        ? { outputTokens: response.data.usage.completion_tokens }
        : {}),
      finishReason: choice.finish_reason ?? "unknown"
    };
  }
}
