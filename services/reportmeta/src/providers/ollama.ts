import { z } from "zod";
import { ReportMetaError } from "../errors.js";
import { parseJsonText, postJson } from "../http.js";
import type {
  ReportMetaProvider,
  StructuredOutputRequest,
  StructuredOutputResult
} from "../types.js";

const ollamaResponseSchema = z
  .object({
    model: z.string(),
    message: z.object({ content: z.string() }).passthrough(),
    done: z.boolean(),
    done_reason: z.string().optional(),
    prompt_eval_count: z.number().optional(),
    eval_count: z.number().optional()
  })
  .passthrough();

export interface OllamaProviderOptions {
  baseUrl: string;
  model: string;
  fetch?: typeof globalThis.fetch;
}

export class OllamaStructuredOutputProvider implements ReportMetaProvider {
  readonly name = "ollama";
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly baseUrl: string;

  constructor(private readonly options: OllamaProviderOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
  }

  async generate(request: StructuredOutputRequest): Promise<StructuredOutputResult> {
    const raw = await postJson(
      this.fetchImpl,
      `${this.baseUrl}/api/chat`,
      {},
      {
        model: this.options.model,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.prompt }
        ],
        format: request.jsonSchema,
        stream: false
      },
      request.signal
    );
    const response = ollamaResponseSchema.safeParse(raw);
    if (!response.success || !response.data.done) {
      throw new ReportMetaError(
        "provider_response",
        "Ollama returned an incomplete response"
      );
    }
    return {
      value: parseJsonText(response.data.message.content),
      model: response.data.model,
      ...(response.data.prompt_eval_count !== undefined
        ? { inputTokens: response.data.prompt_eval_count }
        : {}),
      ...(response.data.eval_count !== undefined
        ? { outputTokens: response.data.eval_count }
        : {}),
      finishReason: response.data.done_reason ?? "done"
    };
  }
}
