import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { evaluateGold } from "./lib/evaluate-gold.mjs";

const gold = JSON.parse(
  fs.readFileSync(
    new URL(
      "../fixtures/policy-documents/walking-skeleton.gold.json",
      import.meta.url
    ),
    "utf8"
  )
);

test("gold evaluator reports exact semantic and evidence matches", () => {
  const dataset = {
    projects: [{ name: "地域移動支援事業" }],
    indicators: [
      {
        name: "公共交通利用者満足度",
        values: [
          {
            id: "target",
            role: "target",
            value: 80,
            unit: "%",
            fiscalYear: "令和7年度",
            evidenceIds: ["target-evidence"]
          },
          {
            id: "actual",
            role: "actual",
            value: 76,
            unit: "%",
            fiscalYear: "令和7年度",
            evidenceIds: ["actual-evidence"]
          }
        ]
      }
    ],
    evidence: [
      {
        id: "target-evidence",
        pageNumber: 1,
        quote: "令和7年度の目標値は80%とする。"
      },
      {
        id: "actual-evidence",
        pageNumber: 2,
        quote: "令和7年度の実績値は76%であった。"
      }
    ]
  };

  const metrics = evaluateGold(dataset, gold);
  assert.equal(metrics.fieldExactMatch, 1);
  assert.equal(metrics.precision, 1);
  assert.equal(metrics.recall, 1);
  assert.equal(metrics.f1, 1);
  assert.equal(metrics.evidencePageAccuracy, 1);
  assert.equal(metrics.evidenceQuoteContainment, 1);
  assert.equal(metrics.fiscalYearAccuracy, 1);
  assert.equal(metrics.unitAccuracy, 1);
});
