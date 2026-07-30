import {
  policyDatasetSchema,
  type Evidence,
  type PolicyDataset
} from "@policygos/policy-schema";
import { ReportMetaError } from "./errors.js";
import type { ReportMetaExtractionRequest } from "./types.js";

export function groundPolicyDataset(
  dataset: PolicyDataset,
  request: ReportMetaExtractionRequest
): PolicyDataset {
  const sourceDocuments = new Map(
    request.documents.map((document) => [document.documentId, document])
  );

  const evidence = dataset.evidence.map((item) => {
    const source = sourceDocuments.get(item.documentId);
    const page = source?.ocr.pages.find(
      ({ pageNumber }) => pageNumber === item.pageNumber
    );
    if (!page || !containsText(page.text, item.quote)) {
      throw new ReportMetaError(
        "schema_validation",
        `Evidence ${item.id} is not an exact quotation from page ${item.pageNumber}`
      );
    }
    return {
      id: item.id,
      documentId: item.documentId,
      pageNumber: item.pageNumber,
      quote: item.quote,
      extractionMethod: pageExtractionMethod(page.extractionMode)
    } satisfies Evidence;
  });
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));

  const sourceTextForEvidence = (evidenceIds: string[]) =>
    evidenceIds
      .map((id) => evidenceById.get(id))
      .filter((item): item is Evidence => Boolean(item))
      .map((item) => {
        const source = sourceDocuments.get(item.documentId);
        return (
          source?.ocr.pages.find(
            ({ pageNumber }) => pageNumber === item.pageNumber
          )?.text ?? ""
        );
      })
      .join("\n");

  const policies = dataset.policies.map((policy) => {
    const sourceText = sourceTextForEvidence(policy.evidenceIds);
    assertGroundedLabel("Policy", policy.id, policy.name, sourceText);
    return {
      ...policy,
      ...(policy.summary && containsText(sourceText, policy.summary)
        ? { summary: policy.summary }
        : { summary: undefined }),
      ...(policy.department && containsText(sourceText, policy.department)
        ? { department: policy.department }
        : { department: undefined }),
      beneficiaries: policy.beneficiaries.filter((value) =>
        containsText(sourceText, value)
      ),
      ...(policy.region && containsText(sourceText, policy.region)
        ? { region: policy.region }
        : { region: undefined }),
      period: groundedPeriod(policy.period, sourceText),
      finances: policy.finances.filter((finance) =>
        finance.evidenceIds.some((id) => {
          const quote = evidenceById.get(id)?.quote ?? "";
          return containsMoney(quote, finance.amount);
        })
      )
    };
  });

  const projects = dataset.projects.map((project) => {
    const sourceText = sourceTextForEvidence(project.evidenceIds);
    assertGroundedLabel("Project", project.id, project.name, sourceText);
    return {
      ...project,
      ...(project.summary && containsText(sourceText, project.summary)
        ? { summary: project.summary }
        : { summary: undefined }),
      ...(project.department && containsText(sourceText, project.department)
        ? { department: project.department }
        : { department: undefined }),
      beneficiaries: project.beneficiaries.filter((value) =>
        containsText(sourceText, value)
      ),
      ...(project.region && containsText(sourceText, project.region)
        ? { region: project.region }
        : { region: undefined }),
      period: groundedPeriod(project.period, sourceText),
      finances: project.finances.filter((finance) =>
        finance.evidenceIds.some((id) =>
          containsMoney(evidenceById.get(id)?.quote ?? "", finance.amount)
        )
      )
    };
  });

  const indicators = dataset.indicators.map((indicator) => {
    const indicatorText = sourceTextForEvidence(indicator.evidenceIds);
    assertGroundedLabel("Indicator", indicator.id, indicator.name, indicatorText);
    return {
      ...indicator,
      ...(indicator.description &&
      containsText(indicatorText, indicator.description)
        ? { description: indicator.description }
        : { description: undefined }),
      values: indicator.values.map((value) => {
        const valueText = value.evidenceIds
          .map((id) => evidenceById.get(id)?.quote ?? "")
          .join("\n");
        if (!containsText(valueText, String(value.value))) {
          throw new ReportMetaError(
            "schema_validation",
            `Metric value ${value.id} is not present in its evidence quotation`
          );
        }
        return {
          ...value,
          reviewStatus: "unreviewed" as const,
          ...(value.unit && containsText(valueText, value.unit)
            ? { unit: value.unit }
            : { unit: undefined }),
          ...(value.fiscalYear && containsText(valueText, value.fiscalYear)
            ? { fiscalYear: value.fiscalYear }
            : { fiscalYear: undefined }),
          ...(value.denominator && containsText(valueText, value.denominator)
            ? { denominator: value.denominator }
            : { denominator: undefined }),
          ...(value.scope && containsText(valueText, value.scope)
            ? { scope: value.scope }
            : { scope: undefined })
        };
      })
    };
  });

  return policyDatasetSchema.parse({
    ...dataset,
    createdAt: new Date().toISOString(),
    documents: dataset.documents.map((document) => {
      const source = sourceDocuments.get(document.id)!;
      const sourceText = source.ocr.pages.map(({ text }) => text).join("\n");
      const metadataTitle =
        typeof source.ocr.metadata.title === "string"
          ? source.ocr.metadata.title
          : undefined;
      return {
        ...document,
        fileName: source.fileName,
        ...(metadataTitle && containsText(sourceText, metadataTitle)
          ? { title: metadataTitle }
          : {}),
        documentType: classifyDocument(sourceText, document.documentType),
        pageCount: source.ocr.pages.length,
        extractionMethod: documentExtractionMethod(source.ocr),
        sourceSchemaVersion: source.ocr.sourceSchemaVersion
      };
    }),
    evidence,
    policies,
    projects,
    indicators,
    reviewItems: [],
    reviewHistory: []
  });
}

function containsText(source: string, candidate: string): boolean {
  return normalizeText(source).includes(normalizeText(candidate));
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "");
}

function containsMoney(source: string, amount: number): boolean {
  const normalized = normalizeText(source).replaceAll(",", "");
  return normalized.includes(`${amount}円`);
}

function groundedPeriod(
  period:
    | { start?: string | undefined; end?: string | undefined }
    | undefined,
  sourceText: string
): { start?: string; end?: string } | undefined {
  if (!period) {
    return undefined;
  }
  const start =
    period.start && containsText(sourceText, period.start)
      ? period.start
      : undefined;
  const end =
    period.end && containsText(sourceText, period.end) ? period.end : undefined;
  return start || end ? { ...(start ? { start } : {}), ...(end ? { end } : {}) } : undefined;
}

function assertGroundedLabel(
  kind: string,
  id: string,
  label: string,
  sourceText: string
): void {
  if (!containsText(sourceText, label)) {
    throw new ReportMetaError(
      "schema_validation",
      `${kind} ${id} is not present on its cited source page`
    );
  }
}

function pageExtractionMethod(
  extractionMode: string
): Evidence["extractionMethod"] {
  if (extractionMode === "digital") {
    return "digital";
  }
  if (extractionMode === "hybrid") {
    return "hybrid";
  }
  return "ocr";
}

function documentExtractionMethod(
  ocr: ReportMetaExtractionRequest["documents"][number]["ocr"]
): PolicyDataset["documents"][number]["extractionMethod"] {
  const methods = new Set(
    ocr.pages.map(({ extractionMode }) => pageExtractionMethod(extractionMode))
  );
  if (methods.size > 1 || methods.has("hybrid")) {
    return "hybrid";
  }
  return methods.has("digital") ? "digital" : "ocr";
}

function classifyDocument(
  sourceText: string,
  fallback: PolicyDataset["documents"][number]["documentType"]
): PolicyDataset["documents"][number]["documentType"] {
  const normalized = normalizeText(sourceText);
  if (normalized.includes("政策評価") || normalized.includes("事業評価")) {
    return "project_evaluation";
  }
  if (normalized.includes("決算")) {
    return "settlement";
  }
  if (normalized.includes("予算")) {
    return "budget";
  }
  if (normalized.includes("統計")) {
    return "statistics";
  }
  if (normalized.includes("計画")) {
    return "policy_plan";
  }
  return fallback;
}
