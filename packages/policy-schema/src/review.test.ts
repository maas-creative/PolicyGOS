import { describe, expect, it } from "vitest";
import { buildPolicyDatasetFixture } from "./fixtures.js";
import { reviewMetricValue } from "./review.js";

describe("metric review transitions", () => {
  it("confirms a value and records an auditable event", () => {
    const reviewed = reviewMetricValue(buildPolicyDatasetFixture(), {
      metricValueId: "metric-actual",
      action: "confirm",
      actor: "reviewer",
      eventId: "event-1",
      occurredAt: "2026-07-31T01:00:00+09:00"
    });
    expect(reviewed.indicators[0]?.values[1]?.reviewStatus).toBe("confirmed");
    expect(reviewed.reviewHistory[0]).toMatchObject({
      id: "event-1",
      targetId: "metric-actual",
      action: "confirm",
      actor: "reviewer"
    });
    expect(reviewed.reviewItems[0]?.status).toBe("resolved");
  });

  it("corrects a value without losing the extracted value", () => {
    const reviewed = reviewMetricValue(buildPolicyDatasetFixture(), {
      metricValueId: "metric-actual",
      action: "correct",
      correctedValue: 77,
      actor: "reviewer",
      eventId: "event-1",
      occurredAt: "2026-07-31T01:00:00+09:00"
    });
    expect(reviewed.indicators[0]?.values[1]).toMatchObject({
      value: 77,
      reviewStatus: "corrected"
    });
    expect(reviewed.reviewHistory[0]?.before).toMatchObject({ value: 76 });
  });

  it("restores the value from review history", () => {
    const corrected = reviewMetricValue(buildPolicyDatasetFixture(), {
      metricValueId: "metric-actual",
      action: "correct",
      correctedValue: 77,
      actor: "reviewer",
      eventId: "event-1",
      occurredAt: "2026-07-31T01:00:00+09:00"
    });
    const restored = reviewMetricValue(corrected, {
      metricValueId: "metric-actual",
      action: "restore",
      actor: "reviewer",
      eventId: "event-2",
      occurredAt: "2026-07-31T01:01:00+09:00"
    });
    expect(restored.indicators[0]?.values[1]).toMatchObject({
      value: 76,
      reviewStatus: "unreviewed"
    });
    expect(restored.reviewItems[0]?.status).toBe("open");
  });

  it("does not confirm a value without evidence", () => {
    const fixture = buildPolicyDatasetFixture();
    fixture.indicators[0]!.values[1]!.evidenceIds = [];
    expect(() =>
      reviewMetricValue(fixture, {
        metricValueId: "metric-actual",
        action: "confirm",
        actor: "reviewer"
      })
    ).toThrow("without evidence");
  });
});
