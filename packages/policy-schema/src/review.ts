import {
  metricValueSchema,
  policyDatasetSchema,
  type MetricValue,
  type PolicyDataset,
  type ReviewEvent
} from "./schema.js";

export interface MetricReviewCommand {
  metricValueId: string;
  action: "confirm" | "correct" | "reject" | "restore";
  actor: string;
  correctedValue?: MetricValue["value"];
  note?: string;
  occurredAt?: string;
  eventId?: string;
}

export function reviewMetricValue(
  dataset: PolicyDataset,
  command: MetricReviewCommand
): PolicyDataset {
  const location = findMetricValue(dataset, command.metricValueId);
  if (!location) {
    throw new Error(`Unknown metric value ID: ${command.metricValueId}`);
  }

  const before = structuredClone(location.value);
  const after = nextMetricValue(dataset, before, command);
  const event: ReviewEvent = {
    id: command.eventId ?? crypto.randomUUID(),
    targetType: "metric_value",
    targetId: command.metricValueId,
    action: command.action,
    actor: command.actor.trim(),
    occurredAt: command.occurredAt ?? new Date().toISOString(),
    before,
    after,
    ...(command.note?.trim() ? { note: command.note.trim() } : {})
  };

  if (!event.actor) {
    throw new Error("Review actor is required");
  }

  const indicators = dataset.indicators.map((indicator, indicatorIndex) =>
    indicatorIndex === location.indicatorIndex
      ? {
          ...indicator,
          values: indicator.values.map((value, valueIndex) =>
            valueIndex === location.valueIndex ? after : value
          )
        }
      : indicator
  );
  const reviewItems = dataset.reviewItems.map((item) =>
    item.targetType === "metric_value" && item.targetId === command.metricValueId
      ? {
          ...item,
          status:
            command.action === "restore"
              ? ("open" as const)
              : ("resolved" as const)
        }
      : item
  );

  return policyDatasetSchema.parse({
    ...dataset,
    indicators,
    reviewItems,
    reviewHistory: [...dataset.reviewHistory, event]
  });
}

function nextMetricValue(
  dataset: PolicyDataset,
  current: MetricValue,
  command: MetricReviewCommand
): MetricValue {
  if (command.action === "restore") {
    const previous = dataset.reviewHistory
      .slice()
      .reverse()
      .find(
        (event) =>
          event.targetType === "metric_value" &&
          event.targetId === command.metricValueId &&
          event.before !== undefined
      )?.before;
    return metricValueSchema.parse(previous);
  }

  if (command.action === "correct" && command.correctedValue === undefined) {
    throw new Error("A corrected value is required");
  }
  if (
    (command.action === "confirm" || command.action === "correct") &&
    current.evidenceIds.length === 0
  ) {
    throw new Error("A value cannot be confirmed without evidence");
  }

  return metricValueSchema.parse({
    ...current,
    ...(command.correctedValue !== undefined
      ? { value: command.correctedValue }
      : {}),
    reviewStatus:
      command.action === "confirm"
        ? "confirmed"
        : command.action === "correct"
          ? "corrected"
          : "rejected"
  });
}

function findMetricValue(dataset: PolicyDataset, metricValueId: string) {
  for (
    let indicatorIndex = 0;
    indicatorIndex < dataset.indicators.length;
    indicatorIndex += 1
  ) {
    const indicator = dataset.indicators[indicatorIndex]!;
    const valueIndex = indicator.values.findIndex(
      (value) => value.id === metricValueId
    );
    if (valueIndex !== -1) {
      return {
        indicatorIndex,
        valueIndex,
        value: indicator.values[valueIndex]!
      };
    }
  }
  return undefined;
}
