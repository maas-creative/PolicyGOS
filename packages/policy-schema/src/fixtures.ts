import {
  POLICY_DATASET_SCHEMA_VERSION,
  type PolicyDataset
} from "./schema.js";

export function buildPolicyDatasetFixture(): PolicyDataset {
  return {
    schemaVersion: POLICY_DATASET_SCHEMA_VERSION,
    datasetId: "dataset-1",
    createdAt: "2026-07-31T00:00:00+09:00",
    documents: [
      {
        id: "document-1",
        fileName: "policy-evaluation.pdf",
        title: "政策評価書",
        municipality: "サンプル市",
        documentType: "project_evaluation",
        pageCount: 2,
        extractionMethod: "digital",
        sourceSchemaVersion: "ocr-backend-v1"
      }
    ],
    evidence: [
      {
        id: "evidence-target",
        documentId: "document-1",
        pageNumber: 1,
        quote: "成果指標の目標値は80%とする。",
        boundingBox: { x0: 10, y0: 20, x1: 200, y1: 40 },
        extractionMethod: "digital"
      },
      {
        id: "evidence-actual",
        documentId: "document-1",
        pageNumber: 2,
        quote: "令和7年度の実績値は76%であった。",
        extractionMethod: "digital"
      }
    ],
    policies: [],
    projects: [
      {
        id: "project-1",
        name: "地域移動支援事業",
        summary: "地域の移動手段を確保する。",
        beneficiaries: ["住民"],
        finances: [],
        evidenceIds: ["evidence-target"]
      }
    ],
    indicators: [
      {
        id: "indicator-1",
        projectId: "project-1",
        kind: "outcome",
        name: "利用者満足度",
        values: [
          {
            id: "metric-target",
            role: "target",
            value: 80,
            fiscalYear: "2025",
            unit: "%",
            evidenceIds: ["evidence-target"],
            confidence: 0.9,
            reviewStatus: "confirmed"
          },
          {
            id: "metric-actual",
            role: "actual",
            value: 76,
            fiscalYear: "2025",
            unit: "%",
            evidenceIds: ["evidence-actual"],
            confidence: 0.85,
            reviewStatus: "unreviewed"
          }
        ],
        evidenceIds: ["evidence-target", "evidence-actual"]
      }
    ],
    reviewItems: [
      {
        id: "review-1",
        kind: "low_confidence",
        status: "open",
        targetType: "metric_value",
        targetId: "metric-actual",
        message: "実績値を原文と照合してください。"
      }
    ],
    reviewHistory: []
  };
}
