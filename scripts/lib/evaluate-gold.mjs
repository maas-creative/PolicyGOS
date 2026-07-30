export function evaluateGold(dataset, gold) {
  const expectedFacts = new Set([
    ...gold.projects.map(({ name }) => `project:${name}`),
    ...gold.metrics.map(metricFact)
  ]);
  const actualFacts = new Set([
    ...dataset.projects.map(({ name }) => `project:${name}`),
    ...dataset.indicators.flatMap((indicator) =>
      indicator.values.map((value) =>
        metricFact({
          indicatorName: indicator.name,
          role: value.role,
          value: value.value,
          unit: value.unit,
          fiscalYear: value.fiscalYear
        })
      )
    )
  ]);
  const matchedFacts = intersectionSize(expectedFacts, actualFacts);
  const precision = ratio(matchedFacts, actualFacts.size);
  const recall = ratio(matchedFacts, expectedFacts.size);

  const fieldChecks = [];
  const evidenceChecks = [];
  const yearChecks = [];
  const unitChecks = [];

  for (const expected of gold.projects) {
    fieldChecks.push(dataset.projects.some(({ name }) => name === expected.name));
  }

  for (const expected of gold.metrics) {
    const candidates = dataset.indicators.flatMap((indicator) =>
      indicator.values
        .filter(
          (value) =>
            indicator.name === expected.indicatorName &&
            value.role === expected.role &&
            value.value === expected.value
        )
        .map((value) => ({ indicator, value }))
    );
    const match = candidates[0];
    fieldChecks.push(
      Boolean(match),
      match?.indicator.name === expected.indicatorName,
      match?.value.role === expected.role,
      match?.value.value === expected.value,
      match?.value.unit === expected.unit,
      match?.value.fiscalYear === expected.fiscalYear
    );
    unitChecks.push(match?.value.unit === expected.unit);
    yearChecks.push(match?.value.fiscalYear === expected.fiscalYear);

    const citedEvidence = match
      ? match.value.evidenceIds
          .map((id) => dataset.evidence.find((item) => item.id === id))
          .filter(Boolean)
      : [];
    evidenceChecks.push({
      page: citedEvidence.some(
        ({ pageNumber }) => pageNumber === expected.evidence.pageNumber
      ),
      quote: citedEvidence.some(({ quote }) =>
        normalize(quote).includes(normalize(expected.evidence.quoteContains))
      )
    });
  }

  const evidencePage = ratio(
    evidenceChecks.filter(({ page }) => page).length,
    evidenceChecks.length
  );
  const evidenceQuote = ratio(
    evidenceChecks.filter(({ quote }) => quote).length,
    evidenceChecks.length
  );

  return {
    fixture: gold.fixture,
    counts: {
      expectedFacts: expectedFacts.size,
      extractedFacts: actualFacts.size,
      matchedFacts
    },
    fieldExactMatch: ratio(
      fieldChecks.filter(Boolean).length,
      fieldChecks.length
    ),
    precision,
    recall,
    f1:
      precision === 0 && recall === 0
        ? 0
        : (2 * precision * recall) / (precision + recall),
    evidencePageAccuracy: evidencePage,
    evidenceQuoteContainment: evidenceQuote,
    fiscalYearAccuracy: ratio(yearChecks.filter(Boolean).length, yearChecks.length),
    unitAccuracy: ratio(unitChecks.filter(Boolean).length, unitChecks.length)
  };
}

function metricFact(metric) {
  return [
    "metric",
    metric.indicatorName,
    metric.role,
    String(metric.value),
    metric.unit ?? "",
    metric.fiscalYear ?? ""
  ].join(":");
}

function intersectionSize(left, right) {
  return [...left].filter((value) => right.has(value)).length;
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 1 : numerator / denominator;
}

function normalize(value) {
  return String(value).normalize("NFKC").replace(/\s+/g, "");
}
