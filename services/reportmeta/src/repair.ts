import type { PolicyDataset } from "@policygos/policy-schema";
import type { ReportMetaExtractionRequest } from "./types.js";

export function repairCandidateReferences(
  dataset: PolicyDataset,
  request: ReportMetaExtractionRequest
): PolicyDataset {
  const evidenceById = new Map(dataset.evidence.map((item) => [item.id, item]));
  const sourceByDocumentId = new Map(
    request.documents.map((item) => [item.documentId, item.ocr])
  );
  const sourcePageText = (evidenceId: string) => {
    const evidence = evidenceById.get(evidenceId);
    if (!evidence) {
      return "";
    }
    return (
      sourceByDocumentId
        .get(evidence.documentId)
        ?.pages.find(({ pageNumber }) => pageNumber === evidence.pageNumber)
        ?.text ?? ""
    );
  };
  const validIds = new Set(evidenceById.keys());
  const referencesForText = (value: string) =>
    dataset.evidence
      .filter(
        (item) =>
          containsText(item.quote, value) ||
          containsText(sourcePageText(item.id), value)
      )
      .map(({ id }) => id);
  const repairedIds = (ids: string[], fallbackText: string) => {
    const retained = ids.filter(
      (id) =>
        validIds.has(id) &&
        (containsText(evidenceById.get(id)?.quote ?? "", fallbackText) ||
          containsText(sourcePageText(id), fallbackText))
    );
    return retained.length > 0 ? retained : referencesForText(fallbackText);
  };

  const policies = dataset.policies.map((policy) => ({
    ...policy,
    evidenceIds: repairedIds(policy.evidenceIds, policy.name),
    finances: policy.finances.map((finance) => ({
      ...finance,
      evidenceIds: repairedIds(finance.evidenceIds, `${finance.amount}円`)
    }))
  }));
  const projects = dataset.projects.map((project) => ({
    ...project,
    evidenceIds: repairedIds(project.evidenceIds, project.name),
    finances: project.finances.map((finance) => ({
      ...finance,
      evidenceIds: repairedIds(finance.evidenceIds, `${finance.amount}円`)
    }))
  }));
  const indicators = dataset.indicators.map((indicator) => {
    const values = indicator.values.map((value) => ({
      ...value,
      evidenceIds: repairedIds(value.evidenceIds, String(value.value))
    }));
    return {
      ...indicator,
      values,
      evidenceIds: [
        ...new Set([
          ...indicator.evidenceIds.filter((id) => validIds.has(id)),
          ...values.flatMap(({ evidenceIds }) => evidenceIds)
        ])
      ]
    };
  });

  return {
    ...dataset,
    documents: [
      ...new Map(dataset.documents.map((document) => [document.id, document])).values()
    ],
    policies,
    projects,
    indicators,
    reviewItems: [],
    reviewHistory: []
  };
}

function containsText(source: string, candidate: string): boolean {
  return source
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .includes(candidate.normalize("NFKC").replace(/\s+/g, ""));
}
