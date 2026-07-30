import { policyOpenUiSystemPrompt } from "@policygos/policy-openui-library";
import type { PolicyDataset } from "@policygos/policy-schema";
import { assertProviderAllowed, type ServerConfig } from "./config.js";

export interface OpenUiGenerationRequest {
  dataset: PolicyDataset;
  question: string;
  audience: "resident" | "staff" | "council" | "researcher";
  previousResponse?: string;
}

export async function requestOpenUiStream(
  request: OpenUiGenerationRequest,
  config: ServerConfig,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  assertProviderAllowed(config.openAiBaseUrl, config.localOnly);
  const response = await fetchImpl(`${config.openAiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openAiApiKey}`
    },
    body: JSON.stringify({
      model: config.openAiModel,
      stream: true,
      temperature: 0,
      messages: [
        { role: "system", content: policyOpenUiSystemPrompt },
        {
          role: "user",
          content: buildGenerationPrompt(request)
        }
      ]
    }),
    signal
  });
  if (!response.ok || !response.body) {
    throw new Error(`OpenUI provider returned HTTP ${response.status}`);
  }
  return response;
}

export async function pipeOpenAiSse(
  response: Response,
  write: (chunk: string) => Promise<unknown>
): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let complete = "";
  let reasoning = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) {
        continue;
      }
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") {
        continue;
      }
      const parsed = JSON.parse(data) as {
        choices?: Array<{
          delta?: { content?: string; reasoning_content?: string };
        }>;
      };
      const delta = parsed.choices?.[0]?.delta;
      const content = delta?.content;
      if (content) {
        complete += content;
        await write(content);
      }
      if (delta?.reasoning_content) {
        reasoning += delta.reasoning_content;
      }
    }
    if (done) {
      break;
    }
  }
  if (!complete && reasoning) {
    complete = reasoning;
    await write(reasoning);
  }
  return complete;
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
${request.previousResponse ? `Previous valid OpenUI response:\n${request.previousResponse}` : ""}
PolicyDataset binding manifest:
${JSON.stringify(manifest)}`;
}
