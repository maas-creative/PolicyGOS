import fs from "node:fs";
import { policyDatasetSchema } from "../packages/policy-schema/dist/index.js";
import { evaluateGold } from "./lib/evaluate-gold.mjs";

const datasetPath = process.argv[2];
if (!datasetPath) {
  throw new Error("Usage: pnpm evaluate:gold -- <policy-dataset.json>");
}

const gold = JSON.parse(
  fs.readFileSync(
    new URL(
      "../fixtures/policy-documents/walking-skeleton.gold.json",
      import.meta.url
    ),
    "utf8"
  )
);
const dataset = policyDatasetSchema.parse(
  JSON.parse(fs.readFileSync(datasetPath, "utf8"))
);

console.log(JSON.stringify(evaluateGold(dataset, gold), null, 2));
