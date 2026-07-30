import { defineComponent, useTriggerAction } from "@openuidev/react-lang";
import type {
  Evidence,
  MetricValue,
  PolicyDataset
} from "@policygos/policy-schema";
import { z } from "zod";
import { usePolicyDataset } from "./context.js";

const identifier = z.string().trim().min(1);

function hasValidEvidence(dataset: PolicyDataset, value: MetricValue): boolean {
  const evidenceIds = new Set(dataset.evidence.map(({ id }) => id));
  return (
    value.evidenceIds.length > 0 &&
    value.evidenceIds.every((id) => evidenceIds.has(id))
  );
}

function isPublishable(dataset: PolicyDataset, value: MetricValue): boolean {
  return (
    (value.reviewStatus === "confirmed" || value.reviewStatus === "corrected") &&
    hasValidEvidence(dataset, value)
  );
}

function formatMetricValue(value: MetricValue): string {
  return `${String(value.value)}${value.unit ? ` ${value.unit}` : ""}`;
}

export const ProjectList = defineComponent({
  name: "ProjectList",
  description:
    "Shows projects by PolicyDataset project IDs. Never pass copied project facts.",
  props: z.object({
    projectIds: z.array(identifier).min(1)
  }),
  component: ({ props }) => {
    const dataset = usePolicyDataset();
    const requested = new Set(props.projectIds);
    const projects = dataset.projects.filter(({ id }) => requested.has(id));
    return (
      <section className="openui-section">
        <p className="openui-kicker">Projects</p>
        <div className="openui-project-grid">
          {projects.map((project) => (
            <article key={project.id} className="openui-project-card">
              <h3>{project.name}</h3>
              {project.summary ? <p>{project.summary}</p> : null}
              {project.department ? <span>{project.department}</span> : null}
            </article>
          ))}
        </div>
      </section>
    );
  }
});

export const MetricComparison = defineComponent({
  name: "MetricComparison",
  description:
    "Compares confirmed/corrected metric values by indicator ID and metric value IDs.",
  props: z.object({
    indicatorId: identifier,
    valueIds: z.array(identifier).min(1)
  }),
  component: ({ props }) => {
    const dataset = usePolicyDataset();
    const indicator = dataset.indicators.find(({ id }) => id === props.indicatorId);
    if (!indicator) {
      return <OpenUiDataMissing label="指標が見つかりません" />;
    }
    const requested = new Set(props.valueIds);
    const values = indicator.values.filter(
      (value) => requested.has(value.id) && isPublishable(dataset, value)
    );
    if (values.length === 0) {
      return <OpenUiDataMissing label="表示できる確認済みの値がありません" />;
    }
    return (
      <section className="openui-section openui-metric-comparison">
        <div className="openui-section-heading">
          <div>
            <p className="openui-kicker">
              {indicator.kind === "outcome" ? "Outcome metric" : "Activity metric"}
            </p>
            <h2>{indicator.name}</h2>
          </div>
          <span>{values[0]?.fiscalYear ?? "年度未設定"}</span>
        </div>
        <div className="openui-metric-grid">
          {values.map((value) => (
            <article key={value.id}>
              <span>{value.role}</span>
              <strong>{formatMetricValue(value)}</strong>
              <small>
                {value.reviewStatus === "corrected" ? "修正確認済み" : "確認済み"}
              </small>
            </article>
          ))}
        </div>
      </section>
    );
  }
});

export const MetricTrend = defineComponent({
  name: "MetricTrend",
  description:
    "Shows a chronological list of confirmed/corrected values for one indicator.",
  props: z.object({
    indicatorId: identifier,
    valueIds: z.array(identifier).min(1)
  }),
  component: ({ props }) => {
    const dataset = usePolicyDataset();
    const indicator = dataset.indicators.find(({ id }) => id === props.indicatorId);
    if (!indicator) {
      return <OpenUiDataMissing label="指標が見つかりません" />;
    }
    const requested = new Set(props.valueIds);
    const values = indicator.values
      .filter((value) => requested.has(value.id) && isPublishable(dataset, value))
      .slice()
      .sort((left, right) =>
        (left.fiscalYear ?? "").localeCompare(right.fiscalYear ?? "", "ja")
      );
    return (
      <section className="openui-section">
        <p className="openui-kicker">Trend</p>
        <h2>{indicator.name}</h2>
        <ol className="openui-trend">
          {values.map((value) => (
            <li key={value.id}>
              <span>{value.fiscalYear ?? "年度不明"}</span>
              <strong>{formatMetricValue(value)}</strong>
            </li>
          ))}
        </ol>
      </section>
    );
  }
});

export const BudgetBreakdown = defineComponent({
  name: "BudgetBreakdown",
  description: "Shows budget and settlement records by project ID.",
  props: z.object({
    projectId: identifier
  }),
  component: ({ props }) => {
    const dataset = usePolicyDataset();
    const project = dataset.projects.find(({ id }) => id === props.projectId);
    const evidenceIds = new Set(dataset.evidence.map(({ id }) => id));
    const finances =
      project?.finances.filter((finance) =>
        finance.evidenceIds.every((id) => evidenceIds.has(id))
      ) ?? [];
    return (
      <section className="openui-section">
        <p className="openui-kicker">Budget</p>
        <h2>{project?.name ?? "事業が見つかりません"}</h2>
        <dl className="openui-budget-list">
          {finances.map((finance) => (
            <div key={`${finance.kind}-${finance.fiscalYear}`}>
              <dt>{finance.fiscalYear} · {finance.kind}</dt>
              <dd>{new Intl.NumberFormat("ja-JP").format(finance.amount)}円</dd>
            </div>
          ))}
        </dl>
      </section>
    );
  }
});

export const EvidenceQuote = defineComponent({
  name: "EvidenceQuote",
  description: "Shows exact source quotations by evidence IDs.",
  props: z.object({
    evidenceIds: z.array(identifier).min(1)
  }),
  component: ({ props }) => {
    const dataset = usePolicyDataset();
    const requested = new Set(props.evidenceIds);
    const evidence = dataset.evidence.filter(({ id }) => requested.has(id));
    return (
      <section className="openui-section">
        <p className="openui-kicker">Evidence</p>
        {evidence.map((item) => (
          <EvidenceBlock key={item.id} evidence={item} dataset={dataset} />
        ))}
      </section>
    );
  }
});

export const ReviewWarning = defineComponent({
  name: "ReviewWarning",
  description: "Shows open review items by review item IDs.",
  props: z.object({
    reviewItemIds: z.array(identifier).min(1)
  }),
  component: ({ props }) => {
    const dataset = usePolicyDataset();
    const requested = new Set(props.reviewItemIds);
    const items = dataset.reviewItems.filter(
      ({ id, status }) => requested.has(id) && status === "open"
    );
    if (items.length === 0) {
      return null;
    }
    return (
      <aside className="openui-review-warning">
        <strong>確認が必要です</strong>
        <ul>
          {items.map((item) => <li key={item.id}>{item.message}</li>)}
        </ul>
      </aside>
    );
  }
});

export const SourceLink = defineComponent({
  name: "SourceLink",
  description: "Opens a source page using an evidence ID.",
  props: z.object({
    evidenceId: identifier,
    label: z.string().trim().min(1).optional()
  }),
  component: ({ props }) => {
    const dataset = usePolicyDataset();
    const evidence = dataset.evidence.find(({ id }) => id === props.evidenceId);
    const triggerAction = useTriggerAction();
    if (!evidence) {
      return <OpenUiDataMissing label="出典が見つかりません" />;
    }
    return (
      <button
        className="openui-source-link"
        type="button"
        onClick={() =>
          triggerAction(props.label ?? `p. ${evidence.pageNumber} を開く`, undefined, {
            type: "open_source",
            params: { evidenceId: evidence.id }
          })
        }
      >
        {props.label ?? `出典 p. ${evidence.pageNumber}`}
      </button>
    );
  }
});

export const AudienceExplanation = defineComponent({
  name: "AudienceExplanation",
  description:
    "Shows a generated explanation for a named audience. Evidence IDs are required for traceability.",
  props: z.object({
    audience: z.enum(["resident", "staff", "council", "researcher"]),
    heading: z.string().trim().min(1),
    body: z.string().trim().min(1),
    evidenceIds: z.array(identifier).min(1)
  }),
  component: ({ props }) => {
    const dataset = usePolicyDataset();
    const validEvidenceIds = new Set(dataset.evidence.map(({ id }) => id));
    if (!props.evidenceIds.every((id) => validEvidenceIds.has(id))) {
      return <OpenUiDataMissing label="説明の根拠参照が不正です" />;
    }
    return (
      <section className="openui-section openui-explanation">
        <span>{props.audience}</span>
        <h2>{props.heading}</h2>
        <p>{props.body}</p>
      </section>
    );
  }
});

const followUpActionSchema = z.object({
  label: z.string().trim().min(1),
  type: z.enum([
    "open_source",
    "change_year",
    "filter_projects",
    "change_audience",
    "go_to_review",
    "save_json",
    "save_csv"
  ]),
  evidenceId: identifier.optional(),
  year: z.string().trim().min(1).optional(),
  projectIds: z.array(identifier).optional(),
  audience: z.enum(["resident", "staff", "council", "researcher"]).optional()
});

export const FollowUpActions = defineComponent({
  name: "FollowUpActions",
  description: "Shows only allowlisted PolicyGOS follow-up actions.",
  props: z.object({
    actions: z.array(followUpActionSchema).min(1).max(6)
  }),
  component: ({ props }) => {
    const triggerAction = useTriggerAction();
    return (
      <div className="openui-follow-up-actions">
        {props.actions.map((action) => (
          <button
            key={`${action.type}-${action.label}`}
            type="button"
            onClick={() =>
              triggerAction(action.label, undefined, {
                type: action.type,
                params: {
                  ...(action.evidenceId ? { evidenceId: action.evidenceId } : {}),
                  ...(action.year ? { year: action.year } : {}),
                  ...(action.projectIds ? { projectIds: action.projectIds } : {}),
                  ...(action.audience ? { audience: action.audience } : {})
                }
              })
            }
          >
            {action.label}
          </button>
        ))}
      </div>
    );
  }
});

export const PolicySummary = defineComponent({
  name: "PolicySummary",
  description:
    "Root layout. Looks up a policy/project by ID and renders registered child sections.",
  props: z.object({
    policyId: identifier.optional(),
    projectId: identifier.optional(),
    sections: z.array(
      z.union([
        ProjectList.ref,
        MetricComparison.ref,
        MetricTrend.ref,
        BudgetBreakdown.ref,
        EvidenceQuote.ref,
        ReviewWarning.ref,
        SourceLink.ref,
        AudienceExplanation.ref,
        FollowUpActions.ref
      ])
    )
  }),
  component: ({ props, renderNode }) => {
    const dataset = usePolicyDataset();
    const item =
      dataset.policies.find(({ id }) => id === props.policyId) ??
      dataset.projects.find(({ id }) => id === props.projectId);
    return (
      <article className="openui-policy-view">
        <header>
          <p className="openui-kicker">Policy brief</p>
          <h1>{item?.name ?? "政策説明"}</h1>
          {item?.summary ? <p>{item.summary}</p> : null}
        </header>
        <div className="openui-sections">
          {props.sections.map((section, index) => (
            <div key={index}>{renderNode(section)}</div>
          ))}
        </div>
      </article>
    );
  }
});

function EvidenceBlock({
  evidence,
  dataset
}: {
  evidence: Evidence;
  dataset: PolicyDataset;
}) {
  const document = dataset.documents.find(({ id }) => id === evidence.documentId);
  return (
    <blockquote className="openui-evidence">
      <p>{evidence.quote}</p>
      <footer>{document?.title ?? document?.fileName} · p. {evidence.pageNumber}</footer>
    </blockquote>
  );
}

function OpenUiDataMissing({ label }: { label: string }) {
  return <div className="openui-data-missing" role="status">{label}</div>;
}
