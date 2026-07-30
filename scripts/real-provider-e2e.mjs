import fs from "node:fs";
import { validatePolicyOpenUiResponse } from "../packages/policy-openui-library/dist/index.js";
import { evaluateGold } from "./lib/evaluate-gold.mjs";

const apiBaseUrl = process.env.POLICYGOS_API_URL ?? "http://127.0.0.1:8787";
const runStartedAt = performance.now();
const fixturePath = new URL(
  "../fixtures/policy-documents/walking-skeleton-policy-evaluation.pdf",
  import.meta.url
);
const documentId = "real-e2e-document";
const gold = JSON.parse(
  fs.readFileSync(
    new URL(
      "../fixtures/policy-documents/walking-skeleton.gold.json",
      import.meta.url
    ),
    "utf8"
  )
);
const form = new FormData();
form.append(
  "file",
  new Blob([fs.readFileSync(fixturePath)], { type: "application/pdf" }),
  "walking-skeleton-policy-evaluation.pdf"
);

const health = await readJson(
  await fetch(`${apiBaseUrl}/api/health`),
  "PolicyGOS health"
);
const ocrStartedAt = performance.now();
const ocrResponse = await fetch(`${apiBaseUrl}/api/ocr/analyze`, {
  method: "POST",
  body: form
});
const ocr = await readJson(ocrResponse, "OCR");
const ocrDurationMs = Math.round(performance.now() - ocrStartedAt);
assert(ocr.pages?.length === 2, "OCR did not return both PDF pages");

const reportMetaStartedAt = performance.now();
const extractionResponse = await fetch(`${apiBaseUrl}/api/reportmeta/extract`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    documents: [
      {
        documentId,
        fileName: "walking-skeleton-policy-evaluation.pdf",
        ocr
      }
    ]
  })
});
const extraction = await readJson(extractionResponse, "ReportMeta");
const reportMetaRoundTripMs = Math.round(
  performance.now() - reportMetaStartedAt
);
const dataset = extraction.dataset;
assert(dataset.documents[0]?.id === documentId, "Document identity changed");
assert(
  dataset.evidence.every((item) => {
    const page = ocr.pages.find(
      ({ pageNumber }) => pageNumber === item.pageNumber
    );
    return page?.text.includes(item.quote);
  }),
  "At least one evidence quote is not present on its cited OCR page"
);
assert(
  dataset.indicators.some((indicator) =>
    indicator.values.some(({ value }) => value === 80)
  ),
  "Target value 80 was not extracted"
);
assert(
  dataset.indicators.some((indicator) =>
    indicator.values.some(({ value }) => value === 76)
  ),
  "Actual value 76 was not extracted"
);

const reviewedDataset = {
  ...dataset,
  indicators: dataset.indicators.map((indicator) => ({
    ...indicator,
    values: indicator.values.map((value) => ({
      ...value,
      reviewStatus: "confirmed"
    }))
  }))
};
const openUiStartedAt = performance.now();
const openUiResponse = await fetch(`${apiBaseUrl}/api/openui/generate`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    dataset: reviewedDataset,
    question: "目標と実績の差を住民向けに根拠付きで説明してください。",
    audience: "resident"
  })
});
if (!openUiResponse.ok) {
  throw new Error(
    `OpenUI failed with HTTP ${openUiResponse.status}: ${await openUiResponse.text()}`
  );
}
const openUi = await openUiResponse.text();
const openUiDurationMs = Math.round(performance.now() - openUiStartedAt);
const validation = validatePolicyOpenUiResponse(openUi);
assert(
  validation.valid,
  `OpenUI output did not pass the component allowlist: ${JSON.stringify({
    output: openUi,
    errors: validation.result.meta.errors,
    unresolved: validation.result.meta.unresolved
  })}`
);
const evaluation = evaluateGold(dataset, gold);

console.log(
  JSON.stringify(
    {
      status: "passed",
      totalDurationMs: Math.round(performance.now() - runStartedAt),
      ocr: {
        pages: ocr.pages.length,
        extractionPath: ocr.extractionPath,
        durationMs: ocrDurationMs
      },
      reportMeta: {
        provider: extraction.provider,
        roundTripMs: reportMetaRoundTripMs,
        evaluation,
        documents: dataset.documents.length,
        evidence: dataset.evidence.length,
        projects: dataset.projects.length,
        indicators: dataset.indicators.length,
        values: dataset.indicators.flatMap((indicator) =>
          indicator.values.map(({ role, value, unit }) => ({
            role,
            value,
            unit
          }))
        )
      },
      openUi: {
        model: health.openUi?.model,
        valid: validation.valid,
        characters: openUi.length,
        durationMs: openUiDurationMs
      },
      runMetrics: {
        schemaValidationFailureRate: 0,
        realPdfE2eSuccessRate: 1,
        humanCorrectionRate: null
      }
    },
    null,
    2
  )
);

async function readJson(response, service) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(
      `${service} failed with HTTP ${response.status}: ${JSON.stringify(body)}`
    );
  }
  return body;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
