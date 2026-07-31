import { z } from "zod";

export const POLICY_DATASET_SCHEMA_VERSION = "policy-dataset-v1" as const;

const identifier = z.string().trim().min(1).max(200);
const optionalText = z.string().trim().min(1).optional();
const confidence = z.number().min(0).max(1);

export const boundingBoxSchema = z
  .object({
    x0: z.number().finite(),
    y0: z.number().finite(),
    x1: z.number().finite(),
    y1: z.number().finite()
  })
  .strict()
  .refine((box) => box.x1 >= box.x0 && box.y1 >= box.y0, {
    message: "Bounding box end coordinates must not precede start coordinates"
  });

export const documentSchema = z
  .object({
    id: identifier,
    fileName: z.string().trim().min(1),
    title: optionalText,
    municipality: optionalText,
    documentType: z.enum([
      "policy_plan",
      "project_evaluation",
      "budget",
      "settlement",
      "statistics",
      "other"
    ]),
    pageCount: z.number().int().positive(),
    extractionMethod: z.enum(["digital", "ocr", "hybrid"]),
    sourceSchemaVersion: z.string().trim().min(1)
  })
  .strict();

export const evidenceSchema = z
  .object({
    id: identifier,
    documentId: identifier,
    pageNumber: z.number().int().positive(),
    quote: z.string().trim().min(1),
    boundingBox: boundingBoxSchema.optional(),
    table: z
      .object({
        tableId: identifier,
        row: z.number().int().nonnegative(),
        column: z.number().int().nonnegative()
      })
      .strict()
      .optional(),
    extractionMethod: z.enum(["digital", "ocr", "hybrid", "llm"]),
    ocrConfidence: confidence.optional()
  })
  .strict();

export const moneySchema = z
  .object({
    amount: z.number().finite(),
    currency: z.literal("JPY"),
    fiscalYear: z.string().trim().min(1),
    kind: z.enum(["budget", "settlement"]),
    evidenceIds: z.array(identifier).min(1)
  })
  .strict();

export const policySchema = z
  .object({
    id: identifier,
    name: z.string().trim().min(1),
    summary: optionalText,
    department: optionalText,
    beneficiaries: z.array(z.string().trim().min(1)).default([]),
    region: optionalText,
    period: z
      .object({
        start: optionalText,
        end: optionalText
      })
      .strict()
      .optional(),
    finances: z.array(moneySchema).default([]),
    evidenceIds: z.array(identifier).min(1)
  })
  .strict();

export const projectSchema = policySchema.extend({
  policyId: identifier.optional()
});

export const metricValueSchema = z
  .object({
    id: identifier,
    role: z.enum(["baseline", "planned", "target", "actual"]),
    value: z.union([z.number().finite(), z.string().trim().min(1)]),
    fiscalYear: optionalText,
    unit: optionalText,
    denominator: optionalText,
    scope: optionalText,
    evidenceIds: z.array(identifier),
    confidence,
    reviewStatus: z.enum(["unreviewed", "confirmed", "corrected", "rejected"])
  })
  .strict();

export const indicatorSchema = z
  .object({
    id: identifier,
    projectId: identifier,
    kind: z.enum(["activity", "outcome"]),
    name: z.string().trim().min(1),
    description: optionalText,
    values: z.array(metricValueSchema).min(1),
    evidenceIds: z.array(identifier).default([])
  })
  .strict();

export const reviewItemSchema = z
  .object({
    id: identifier,
    kind: z.enum([
      "missing_evidence",
      "missing_unit",
      "missing_year",
      "conflicting_value",
      "low_confidence",
      "other"
    ]),
    status: z.enum(["open", "resolved", "dismissed"]),
    targetType: z.enum(["document", "policy", "project", "indicator", "metric_value"]),
    targetId: identifier,
    message: z.string().trim().min(1)
  })
  .strict();

export const reviewEventSchema = z
  .object({
    id: identifier,
    targetType: z.enum(["policy", "project", "indicator", "metric_value"]),
    targetId: identifier,
    action: z.enum(["confirm", "correct", "reject", "restore"]),
    actor: z.string().trim().min(1),
    occurredAt: z.string().datetime({ offset: true }),
    before: z.unknown().optional(),
    after: z.unknown().optional(),
    note: optionalText
  })
  .strict();

export const policyDatasetCandidateSchema = z
  .object({
    schemaVersion: z.literal(POLICY_DATASET_SCHEMA_VERSION),
    datasetId: identifier,
    createdAt: z.string().datetime({ offset: true }),
    documents: z.array(documentSchema).min(1),
    evidence: z.array(evidenceSchema),
    policies: z.array(policySchema),
    projects: z.array(projectSchema),
    indicators: z.array(indicatorSchema),
    reviewItems: z.array(reviewItemSchema).default([]),
    reviewHistory: z.array(reviewEventSchema).default([])
  })
  .strict();

function uniqueIds(
  values: ReadonlyArray<{ id: string }>,
  path: string,
  context: z.RefinementCtx
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value.id)) {
      context.addIssue({
        code: "custom",
        path: [path, index, "id"],
        message: `Duplicate ID: ${value.id}`
      });
    }
    seen.add(value.id);
  });
}

export const policyDatasetSchema = policyDatasetCandidateSchema.superRefine(
  (dataset, context) => {
    uniqueIds(dataset.documents, "documents", context);
    uniqueIds(dataset.evidence, "evidence", context);
    uniqueIds(dataset.policies, "policies", context);
    uniqueIds(dataset.projects, "projects", context);
    uniqueIds(dataset.indicators, "indicators", context);
    uniqueIds(dataset.reviewItems, "reviewItems", context);
    uniqueIds(dataset.reviewHistory, "reviewHistory", context);

    const documentIds = new Set(dataset.documents.map(({ id }) => id));
    const evidenceIds = new Set(dataset.evidence.map(({ id }) => id));
    const policyIds = new Set(dataset.policies.map(({ id }) => id));
    const projectIds = new Set(dataset.projects.map(({ id }) => id));
    const indicatorIds = new Set(dataset.indicators.map(({ id }) => id));
    const metricValueIds = new Set(
      dataset.indicators.flatMap(({ values }) => values.map(({ id }) => id))
    );

    uniqueIds(
      dataset.indicators.flatMap(({ values }) => values),
      "metricValues",
      context
    );

    dataset.evidence.forEach((item, index) => {
      if (!documentIds.has(item.documentId)) {
        context.addIssue({
          code: "custom",
          path: ["evidence", index, "documentId"],
          message: `Unknown document ID: ${item.documentId}`
        });
      }
      const document = dataset.documents.find(({ id }) => id === item.documentId);
      if (document && item.pageNumber > document.pageCount) {
        context.addIssue({
          code: "custom",
          path: ["evidence", index, "pageNumber"],
          message: `Page ${item.pageNumber} exceeds document page count`
        });
      }
    });

    const checkEvidenceIds = (ids: string[], path: PropertyKey[]) => {
      ids.forEach((id, index) => {
        if (!evidenceIds.has(id)) {
          context.addIssue({
            code: "custom",
            path: [...path, index],
            message: `Unknown evidence ID: ${id}`
          });
        }
      });
    };

    dataset.policies.forEach((policy, index) => {
      checkEvidenceIds(policy.evidenceIds, ["policies", index, "evidenceIds"]);
      policy.finances.forEach((finance, financeIndex) =>
        checkEvidenceIds(finance.evidenceIds, [
          "policies",
          index,
          "finances",
          financeIndex,
          "evidenceIds"
        ])
      );
    });

    dataset.projects.forEach((project, index) => {
      if (project.policyId && !policyIds.has(project.policyId)) {
        context.addIssue({
          code: "custom",
          path: ["projects", index, "policyId"],
          message: `Unknown policy ID: ${project.policyId}`
        });
      }
      checkEvidenceIds(project.evidenceIds, ["projects", index, "evidenceIds"]);
      project.finances.forEach((finance, financeIndex) =>
        checkEvidenceIds(finance.evidenceIds, [
          "projects",
          index,
          "finances",
          financeIndex,
          "evidenceIds"
        ])
      );
    });

    dataset.indicators.forEach((indicator, indicatorIndex) => {
      if (!projectIds.has(indicator.projectId)) {
        context.addIssue({
          code: "custom",
          path: ["indicators", indicatorIndex, "projectId"],
          message: `Unknown project ID: ${indicator.projectId}`
        });
      }
      checkEvidenceIds(indicator.evidenceIds, [
        "indicators",
        indicatorIndex,
        "evidenceIds"
      ]);
      indicator.values.forEach((metricValue, valueIndex) => {
        checkEvidenceIds(metricValue.evidenceIds, [
          "indicators",
          indicatorIndex,
          "values",
          valueIndex,
          "evidenceIds"
        ]);
        if (
          ["confirmed", "corrected"].includes(metricValue.reviewStatus) &&
          metricValue.evidenceIds.length === 0
        ) {
          context.addIssue({
            code: "custom",
            path: [
              "indicators",
              indicatorIndex,
              "values",
              valueIndex,
              "evidenceIds"
            ],
            message: "Confirmed or corrected values require evidence"
          });
        }
      });
    });

    const targetIdsByType = {
      document: documentIds,
      policy: policyIds,
      project: projectIds,
      indicator: indicatorIds,
      metric_value: metricValueIds
    };
    dataset.reviewItems.forEach((item, index) => {
      if (!targetIdsByType[item.targetType].has(item.targetId)) {
        context.addIssue({
          code: "custom",
          path: ["reviewItems", index, "targetId"],
          message: `Unknown ${item.targetType} ID: ${item.targetId}`
        });
      }
    });
    dataset.reviewHistory.forEach((event, index) => {
      if (!targetIdsByType[event.targetType].has(event.targetId)) {
        context.addIssue({
          code: "custom",
          path: ["reviewHistory", index, "targetId"],
          message: `Unknown ${event.targetType} ID: ${event.targetId}`
        });
      }
    });
  }
);

export type BoundingBox = z.infer<typeof boundingBoxSchema>;
export type PolicyDocument = z.infer<typeof documentSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type Policy = z.infer<typeof policySchema>;
export type Project = z.infer<typeof projectSchema>;
export type MetricValue = z.infer<typeof metricValueSchema>;
export type Indicator = z.infer<typeof indicatorSchema>;
export type ReviewItem = z.infer<typeof reviewItemSchema>;
export type ReviewEvent = z.infer<typeof reviewEventSchema>;
export type PolicyDataset = z.infer<typeof policyDatasetSchema>;
