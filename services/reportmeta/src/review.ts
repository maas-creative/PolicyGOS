import {
  policyDatasetSchema,
  type PolicyDataset,
  type ReviewItem
} from "@policygos/policy-schema";

export function addDerivedReviewItems(dataset: PolicyDataset): PolicyDataset {
  const existingKeys = new Set(
    dataset.reviewItems.map((item) => `${item.kind}:${item.targetId}`)
  );
  const derived: ReviewItem[] = [];

  const add = (item: ReviewItem) => {
    const key = `${item.kind}:${item.targetId}`;
    if (!existingKeys.has(key)) {
      existingKeys.add(key);
      derived.push(item);
    }
  };

  dataset.indicators.forEach((indicator) => {
    indicator.values.forEach((metricValue) => {
      if (metricValue.evidenceIds.length === 0) {
        add({
          id: `review-missing-evidence-${metricValue.id}`,
          kind: "missing_evidence",
          status: "open",
          targetType: "metric_value",
          targetId: metricValue.id,
          message: "値に根拠がありません。"
        });
      }
      if (!metricValue.unit) {
        add({
          id: `review-missing-unit-${metricValue.id}`,
          kind: "missing_unit",
          status: "open",
          targetType: "metric_value",
          targetId: metricValue.id,
          message: "値の単位が不明です。"
        });
      }
      if (!metricValue.fiscalYear) {
        add({
          id: `review-missing-year-${metricValue.id}`,
          kind: "missing_year",
          status: "open",
          targetType: "metric_value",
          targetId: metricValue.id,
          message: "値の年度が不明です。"
        });
      }
      if (metricValue.confidence < 0.7) {
        add({
          id: `review-low-confidence-${metricValue.id}`,
          kind: "low_confidence",
          status: "open",
          targetType: "metric_value",
          targetId: metricValue.id,
          message: "抽出confidenceが0.7未満です。"
        });
      }
    });

    const valuesByKey = new Map<string, Set<string>>();
    indicator.values.forEach((metricValue) => {
      const key = `${metricValue.role}:${metricValue.fiscalYear ?? "unknown"}`;
      const values = valuesByKey.get(key) ?? new Set<string>();
      values.add(String(metricValue.value));
      valuesByKey.set(key, values);
    });
    for (const [key, values] of valuesByKey) {
      if (values.size > 1) {
        add({
          id: `review-conflict-${indicator.id}-${key.replaceAll(":", "-")}`,
          kind: "conflicting_value",
          status: "open",
          targetType: "indicator",
          targetId: indicator.id,
          message: `同じ役割・年度に異なる値があります: ${[...values].join(", ")}`
        });
      }
    }
  });

  return policyDatasetSchema.parse({
    ...dataset,
    reviewItems: [...dataset.reviewItems, ...derived]
  });
}
