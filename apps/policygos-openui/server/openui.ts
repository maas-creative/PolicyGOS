import {
  policyOpenUiSystemPrompt,
  validatePolicyOpenUiResponse
} from "@policygos/policy-openui-library";
import type { PolicyDataset } from "@policygos/policy-schema";
import { assertProviderAllowed, type ServerConfig } from "./config.js";

export interface OpenUiGenerationRequest {
  dataset: PolicyDataset;
  question: string;
  audience: "resident" | "staff" | "council" | "researcher";
  previousResponse?: string;
}

export async function requestOpenUiProgram(
  request: OpenUiGenerationRequest,
  config: ServerConfig,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  assertProviderAllowed(config.openAiBaseUrl, config.localOnly);
  const response = await fetchImpl(`${config.openAiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openAiApiKey}`
    },
    body: JSON.stringify({
      model: config.openUiModel,
      stream: false,
      temperature: 0,
      max_tokens: 768,
      messages: [
        { role: "system", content: `/no_think\n${policyOpenUiSystemPrompt}` },
        {
          role: "user",
          content: buildGenerationPrompt(request)
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "openui_program",
          strict: true,
          schema: {
            type: "object",
            properties: {
              program: {
                type: "string",
                description: "A complete PolicyGOS OpenUI DSL program"
              }
            },
            required: ["program"],
            additionalProperties: false
          }
        }
      }
    }),
    signal
  });
  if (!response.ok) {
    throw new Error(`OpenUI provider returned HTTP ${response.status}`);
  }
  const result = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
        reasoning?: string;
        reasoning_content?: string;
      };
    }>;
  };
  const message = result.choices?.[0]?.message;
  const raw = message?.content || message?.reasoning || message?.reasoning_content;
  if (!raw) {
    throw new Error("OpenUI provider returned an empty completion");
  }
  let program: unknown;
  try {
    program = (JSON.parse(raw) as { program?: unknown }).program;
  } catch {
    throw new Error("OpenUI provider returned invalid structured output");
  }
  if (typeof program !== "string" || !program.trim()) {
    throw new Error("OpenUI provider returned no program");
  }
  const validation = validatePolicyOpenUiResponse(program);
  if (!validation.valid) {
    throw new Error("OpenUI provider returned an invalid or incomplete program");
  }
  return program;
}

function buildGenerationPrompt(request: OpenUiGenerationRequest): string {
  const values = request.dataset.indicators.flatMap((indicator) =>
    indicator.values
      .filter(({ reviewStatus }) =>
        ["confirmed", "corrected"].includes(reviewStatus)
      )
      .map((value) => ({
        indicatorId: indicator.id,
        indicatorName: indicator.name,
        kind: indicator.kind,
        valueId: value.id,
        role: value.role,
        fiscalYear: value.fiscalYear,
        evidenceIds: value.evidenceIds
      }))
  );
  const manifest = {
    policies: request.dataset.policies.map(({ id, name, evidenceIds }) => ({
      id,
      name,
      evidenceIds
    })),
    projects: request.dataset.projects.map(
      ({ id, policyId, name, evidenceIds }) => ({
        id,
        policyId,
        name,
        evidenceIds
      })
    ),
    confirmedMetricBindings: values,
    evidence: request.dataset.evidence.map(
      ({ id, documentId, pageNumber, quote }) => ({
        id,
        documentId,
        pageNumber,
        quote
      })
    ),
    openReviewItems: request.dataset.reviewItems
      .filter(({ status }) => status === "open")
      .map(({ id, kind, targetId }) => ({ id, kind, targetId }))
  };

  return `Question: ${request.question}
Audience: ${request.audience}
Use MetricComparison/MetricTrend IDs for all exact values. Do not restate exact values inside AudienceExplanation body.
Keep the program compact: root plus at most three child component statements. Finish every statement before adding another.
${request.previousResponse ? `Previous valid OpenUI response:\n${request.previousResponse}` : ""}
PolicyDataset binding manifest:
${JSON.stringify(manifest)}`;
}
