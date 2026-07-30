import {
  buildPolicyDatasetFixture,
  reviewMetricValue,
  type Evidence,
  type Indicator,
  type MetricValue,
  type PolicyDataset
} from "@policygos/policy-schema";
import {
  SafePolicyRenderer,
  type AllowedPolicyAction
} from "@policygos/policy-openui-library";
import { useEffect, useMemo, useState } from "react";
import {
  analyzePdf,
  extractPolicyDatasetFromOcr,
  generateOpenUi
} from "./api.js";
import {
  clearWorkspace,
  loadSourcePdf,
  loadPolicyDataset,
  savePolicyDataset,
  saveSourcePdf
} from "./storage.js";

interface SelectedMetric {
  indicator: Indicator;
  value: MetricValue;
}

interface SourceRequest {
  documentId: string;
  pageNumber: number;
}

const reviewStatusLabels: Record<MetricValue["reviewStatus"], string> = {
  unreviewed: "未確認",
  confirmed: "確認済み",
  corrected: "修正済み",
  rejected: "却下"
};

export function App() {
  const [dataset, setDataset] = useState<PolicyDataset>();
  const [selectedMetricId, setSelectedMetricId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  const [view, setView] = useState<"review" | "explain">("review");
  const [pipelineState, setPipelineState] = useState<
    "idle" | "ocr" | "extracting" | "error"
  >("idle");
  const [pipelineError, setPipelineError] = useState<string>();
  const [sourceRequest, setSourceRequest] = useState<SourceRequest>();

  useEffect(() => {
    let active = true;
    void loadPolicyDataset()
      .then((stored) => {
        if (active) {
          setDataset(stored);
          setSelectedMetricId(stored?.indicators[0]?.values[0]?.id);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const selectedMetric = useMemo(
    () => findSelectedMetric(dataset, selectedMetricId),
    [dataset, selectedMetricId]
  );

  const counts = useMemo(() => {
    const values = dataset?.indicators.flatMap((indicator) => indicator.values) ?? [];
    return {
      total: values.length,
      reviewed: values.filter(({ reviewStatus }) =>
        ["confirmed", "corrected", "rejected"].includes(reviewStatus)
      ).length,
      open: dataset?.reviewItems.filter(({ status }) => status === "open").length ?? 0
    };
  }, [dataset]);

  const handleReview = (
    metricValueId: string,
    action: "confirm" | "correct" | "reject" | "restore",
    correctedValue?: MetricValue["value"]
  ) => {
    if (!dataset) {
      return;
    }
    const next = reviewMetricValue(dataset, {
      metricValueId,
      action,
      actor: "local-reviewer",
      ...(correctedValue !== undefined ? { correctedValue } : {})
    });
    setDataset(next);
    setSaveState("saving");
    void savePolicyDataset(next)
      .then(() => setSaveState("saved"))
      .catch(() => setSaveState("error"));
  };

  const handlePdf = async (file: File) => {
    setPipelineError(undefined);
    setPipelineState("ocr");
    try {
      const ocr = await analyzePdf(file);
      setPipelineState("extracting");
      const documentId = crypto.randomUUID();
      const extracted = await extractPolicyDatasetFromOcr(
        documentId,
        file.name,
        ocr
      );
      setDataset(extracted);
      setSelectedMetricId(extracted.indicators[0]?.values[0]?.id);
      await saveSourcePdf(documentId, file);
      await savePolicyDataset(extracted);
      setSaveState("saved");
      setPipelineState("idle");
    } catch (error) {
      setPipelineState("error");
      setPipelineError(error instanceof Error ? error.message : String(error));
    }
  };

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <div className="app-shell">
      <Header
        saveState={saveState}
        hasDataset={Boolean(dataset)}
        onNewDocument={() => {
          if (window.confirm("現在のローカルワークスペースを閉じて、新しい文書を始めますか？")) {
            setDataset(undefined);
            setSelectedMetricId(undefined);
            setView("review");
            setSourceRequest(undefined);
            void clearWorkspace();
          }
        }}
      />
      <div className="workspace-layout">
        <WorkflowNavigation hasDataset={Boolean(dataset)} view={view} />
        <main className="workspace-main">
          {dataset ? (
            <>
              {view === "review" ? (
              <>
              <section className="page-heading" aria-labelledby="review-title">
                <div>
                  <p className="eyebrow">Step 2 · Review</p>
                  <h1 id="review-title">抽出結果を確認</h1>
                  <p className="heading-copy">
                    数値と根拠を照合し、公開用の説明へ渡せる状態にします。
                  </p>
                </div>
                <div className="progress-ring" aria-label={`${counts.reviewed}/${counts.total}件確認済み`}>
                  <strong>{counts.reviewed}</strong>
                  <span>/ {counts.total}</span>
                </div>
              </section>

              <SummaryStrip dataset={dataset} openReviewItems={counts.open} />

              <div className="review-layout">
                <section className="metric-list" aria-label="抽出された指標値">
                  {dataset.indicators.flatMap((indicator) =>
                    indicator.values.map((value) => (
                      <MetricReviewCard
                        key={value.id}
                        indicator={indicator}
                        value={value}
                        selected={selectedMetricId === value.id}
                        onSelect={() => setSelectedMetricId(value.id)}
                        onReview={handleReview}
                      />
                    ))
                  )}
                </section>
                <EvidencePanel
                  dataset={dataset}
                  selected={selectedMetric}
                  onOpenSource={setSourceRequest}
                />
              </div>
              <div className="review-next">
                <div>
                  <strong>
                    {counts.reviewed === counts.total
                      ? "確認が完了しました"
                      : `残り${counts.total - counts.reviewed}件です`}
                  </strong>
                  <p>確認済み・修正済みの値だけが説明画面に渡ります。</p>
                </div>
                <button
                  className="button button-primary"
                  type="button"
                  disabled={counts.reviewed !== counts.total}
                  onClick={() => setView("explain")}
                >
                  説明を作る
                </button>
              </div>
              </>
              ) : (
                <ExplanationWorkspace
                  dataset={dataset}
                  onBackToReview={() => setView("review")}
                  onOpenSource={setSourceRequest}
                />
              )}
            </>
          ) : (
            <EmptyWorkspace
              pipelineState={pipelineState}
              error={pipelineError}
              onFile={(file) => void handlePdf(file)}
              onLoadFixture={() => {
                const fixture = buildPolicyDatasetFixture();
                setDataset(fixture);
                setSelectedMetricId(fixture.indicators[0]?.values[0]?.id);
                void savePolicyDataset(fixture);
              }}
            />
          )}
        </main>
      </div>
      {sourceRequest ? (
        <SourceViewer
          dataset={dataset}
          request={sourceRequest}
          onClose={() => setSourceRequest(undefined)}
        />
      ) : null}
    </div>
  );
}

function Header({
  saveState,
  hasDataset,
  onNewDocument
}: {
  saveState: "idle" | "saving" | "saved" | "error";
  hasDataset: boolean;
  onNewDocument: () => void;
}) {
  const saveLabel = {
    idle: "ローカル保存",
    saving: "保存中…",
    saved: "保存済み",
    error: "保存エラー"
  }[saveState];
  return (
    <header className="topbar">
      <a className="brand" href="/" aria-label="PolicyGOS Next ホーム">
        <span className="brand-mark" aria-hidden="true">P</span>
        <span>
          <strong>PolicyGOS</strong>
          <small>Evidence workspace</small>
        </span>
      </a>
      <div className="topbar-actions">
        {hasDataset ? (
          <button type="button" onClick={onNewDocument}>新しい文書</button>
        ) : null}
        <div className={`save-status save-status-${saveState}`} role="status">
          <span aria-hidden="true" />
          {saveLabel}
        </div>
      </div>
    </header>
  );
}

function WorkflowNavigation({
  hasDataset,
  view
}: {
  hasDataset: boolean;
  view: "review" | "explain";
}) {
  const steps = [
    { number: "01", label: "文書", status: hasDataset ? "complete" : "current" },
    {
      number: "02",
      label: "確認",
      status: hasDataset ? (view === "review" ? "current" : "complete") : "upcoming"
    },
    {
      number: "03",
      label: "説明",
      status: hasDataset && view === "explain" ? "current" : "upcoming"
    }
  ] as const;
  return (
    <nav className="workflow-nav" aria-label="作業ステップ">
      <p className="nav-label">Workspace</p>
      <ol>
        {steps.map((step) => (
          <li className={`step step-${step.status}`} key={step.number}>
            <span className="step-number">{step.number}</span>
            <span>{step.label}</span>
          </li>
        ))}
      </ol>
      <div className="privacy-note">
        <strong>Local first</strong>
        <p>確認内容はこの端末のブラウザ内に保存されます。</p>
      </div>
    </nav>
  );
}

function SummaryStrip({
  dataset,
  openReviewItems
}: {
  dataset: PolicyDataset;
  openReviewItems: number;
}) {
  return (
    <section className="summary-strip" aria-label="データセット概要">
      <div>
        <span>Document</span>
        <strong>{dataset.documents[0]?.title ?? dataset.documents[0]?.fileName}</strong>
      </div>
      <div>
        <span>Projects</span>
        <strong>{dataset.projects.length}</strong>
      </div>
      <div>
        <span>Indicators</span>
        <strong>{dataset.indicators.length}</strong>
      </div>
      <div>
        <span>Needs review</span>
        <strong className={openReviewItems > 0 ? "warning-text" : ""}>
          {openReviewItems}
        </strong>
      </div>
    </section>
  );
}

function MetricReviewCard({
  indicator,
  value,
  selected,
  onSelect,
  onReview
}: {
  indicator: Indicator;
  value: MetricValue;
  selected: boolean;
  onSelect: () => void;
  onReview: (
    id: string,
    action: "confirm" | "correct" | "reject" | "restore",
    correctedValue?: MetricValue["value"]
  ) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [correctedValue, setCorrectedValue] = useState(String(value.value));
  const isReviewed = value.reviewStatus !== "unreviewed";

  return (
    <article
      className={`metric-card${selected ? " metric-card-selected" : ""}`}
      onClick={onSelect}
    >
      <div className="metric-card-heading">
        <div>
          <span className="metric-kind">
            {indicator.kind === "outcome" ? "成果指標" : "活動指標"}
          </span>
          <h2>{indicator.name}</h2>
        </div>
        <span className={`status-badge status-${value.reviewStatus}`}>
          {reviewStatusLabels[value.reviewStatus]}
        </span>
      </div>
      <div className="metric-value-row">
        <strong>{String(value.value)}</strong>
        <span>{value.unit ?? "単位不明"}</span>
        <span className="metric-meta">{value.fiscalYear ?? "年度不明"}</span>
        <span className="metric-role">{value.role}</span>
      </div>
      <div className="confidence-row">
        <span>抽出confidence</span>
        <div className="confidence-track" aria-hidden="true">
          <span style={{ transform: `scaleX(${value.confidence})` }} />
        </div>
        <strong>{Math.round(value.confidence * 100)}%</strong>
      </div>

      {editing ? (
        <form
          className="correction-form"
          onSubmit={(event) => {
            event.preventDefault();
            const numeric = Number(correctedValue);
            onReview(
              value.id,
              "correct",
              Number.isNaN(numeric) ? correctedValue : numeric
            );
            setEditing(false);
          }}
        >
          <label>
            修正後の値
            <input
              value={correctedValue}
              onChange={(event) => setCorrectedValue(event.target.value)}
              autoFocus
            />
          </label>
          <button className="button button-primary" type="submit">修正を保存</button>
          <button className="button button-quiet" type="button" onClick={() => setEditing(false)}>
            キャンセル
          </button>
        </form>
      ) : (
        <div className="metric-actions">
          {isReviewed ? (
            <button
              className="button button-quiet"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onReview(value.id, "restore");
              }}
            >
              元に戻す
            </button>
          ) : (
            <>
              <button
                className="button button-primary"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onReview(value.id, "confirm");
                }}
              >
                根拠と一致
              </button>
              <button
                className="button button-secondary"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setEditing(true);
                }}
              >
                修正
              </button>
              <button
                className="button button-danger"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onReview(value.id, "reject");
                }}
              >
                却下
              </button>
            </>
          )}
        </div>
      )}
    </article>
  );
}

function EvidencePanel({
  dataset,
  selected,
  onOpenSource
}: {
  dataset: PolicyDataset;
  selected: SelectedMetric | undefined;
  onOpenSource: (request: SourceRequest) => void;
}) {
  if (!selected) {
    return (
      <aside className="evidence-panel">
        <p>指標値を選ぶと根拠が表示されます。</p>
      </aside>
    );
  }
  const evidenceById = new Map(dataset.evidence.map((item) => [item.id, item]));
  const evidence = selected.value.evidenceIds
    .map((id) => evidenceById.get(id))
    .filter((item): item is Evidence => Boolean(item));

  return (
    <aside className="evidence-panel" aria-labelledby="evidence-title">
      <div className="evidence-heading">
        <div>
          <p className="eyebrow">Source</p>
          <h2 id="evidence-title">根拠を照合</h2>
        </div>
        <span>{evidence.length}件</span>
      </div>
      {evidence.length > 0 ? (
        evidence.map((item) => {
          const document = dataset.documents.find(({ id }) => id === item.documentId);
          return (
            <blockquote key={item.id}>
              <p>{item.quote}</p>
              <footer>
                <span>{document?.title ?? document?.fileName}</span>
                <button
                  type="button"
                  onClick={() =>
                    onOpenSource({
                      documentId: item.documentId,
                      pageNumber: item.pageNumber
                    })
                  }
                >
                  p. {item.pageNumber} を開く
                </button>
              </footer>
            </blockquote>
          );
        })
      ) : (
        <div className="missing-evidence">
          <strong>根拠がありません</strong>
          <p>この値は確認済みにできません。文書内の出典を追加してください。</p>
        </div>
      )}
      <div className="review-history">
        <h3>確認履歴</h3>
        {dataset.reviewHistory
          .filter(({ targetId }) => targetId === selected.value.id)
          .slice()
          .reverse()
          .map((event) => (
            <div key={event.id}>
              <span>{event.action}</span>
              <time dateTime={event.occurredAt}>
                {new Date(event.occurredAt).toLocaleString("ja-JP")}
              </time>
            </div>
          ))}
        {dataset.reviewHistory.every(
          ({ targetId }) => targetId !== selected.value.id
        ) ? <p>まだ操作履歴はありません。</p> : null}
      </div>
    </aside>
  );
}

function EmptyWorkspace({
  onLoadFixture,
  onFile,
  pipelineState,
  error
}: {
  onLoadFixture: () => void;
  onFile: (file: File) => void;
  pipelineState: "idle" | "ocr" | "extracting" | "error";
  error: string | undefined;
}) {
  const busy = pipelineState === "ocr" || pipelineState === "extracting";
  const progressLabel =
    pipelineState === "ocr"
      ? "OCRで文書を解析しています…"
      : pipelineState === "extracting"
        ? "ReportMetaで政策データを抽出しています…"
        : undefined;
  return (
    <section className="empty-workspace">
      <p className="eyebrow">Step 1 · Documents</p>
      <h1>政策文書から始める</h1>
      <p>
        PDFをOCRし、政策・事業・指標・値を根拠ページとともに抽出します。
      </p>
      <div className="drop-zone">
        <strong>PDFをここにドロップ</strong>
        <span>またはファイルを選択 · 最大50MB</span>
        <label className={`button button-primary${busy ? " button-disabled" : ""}`}>
          PDFを選択
          <input
            className="visually-hidden"
            type="file"
            accept="application/pdf,.pdf"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                onFile(file);
              }
            }}
          />
        </label>
      </div>
      {progressLabel ? <p className="pipeline-status" role="status">{progressLabel}</p> : null}
      {error ? <p className="pipeline-error" role="alert">{error}</p> : null}
      <button className="sample-button" type="button" onClick={onLoadFixture}>
        サンプルデータで確認画面を見る
      </button>
    </section>
  );
}

function ExplanationWorkspace({
  dataset,
  onBackToReview,
  onOpenSource
}: {
  dataset: PolicyDataset;
  onBackToReview: () => void;
  onOpenSource: (request: SourceRequest) => void;
}) {
  const [question, setQuestion] = useState(
    "目標と実績の差を、住民にわかるよう根拠付きで説明してください。"
  );
  const [audience, setAudience] = useState<
    "resident" | "staff" | "council" | "researcher"
  >("resident");
  const [response, setResponse] = useState("");
  const [lastValidResponse, setLastValidResponse] = useState<string>();
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const submit = async () => {
    setStreaming(true);
    setError(undefined);
    setNotice(undefined);
    setResponse("");
    try {
      const completed = await generateOpenUi(
        {
          dataset,
          question,
          audience,
          ...(lastValidResponse ? { previousResponse: lastValidResponse } : {})
        },
        setResponse
      );
      setLastValidResponse(completed);
    } catch (generationError) {
      setError(
        generationError instanceof Error
          ? generationError.message
          : String(generationError)
      );
    } finally {
      setStreaming(false);
    }
  };

  const handleAction = (action: AllowedPolicyAction) => {
    if (action.type === "open_source") {
      const evidenceId = action.params.evidenceId;
      const evidence =
        typeof evidenceId === "string"
          ? dataset.evidence.find(({ id }) => id === evidenceId)
          : undefined;
      if (evidence) {
        onOpenSource({
          documentId: evidence.documentId,
          pageNumber: evidence.pageNumber
        });
      } else {
        setError("指定された出典がデータセットにありません。");
      }
      return;
    }
    if (action.type === "go_to_review") {
      onBackToReview();
      return;
    }
    if (action.type === "change_audience") {
      const nextAudience = action.params.audience;
      if (
        nextAudience === "resident" ||
        nextAudience === "staff" ||
        nextAudience === "council" ||
        nextAudience === "researcher"
      ) {
        setAudience(nextAudience);
      }
      return;
    }
    if (action.type === "save_json") {
      downloadText(
        `${dataset.datasetId}.json`,
        JSON.stringify(dataset, null, 2),
        "application/json"
      );
      return;
    }
    if (action.type === "save_csv") {
      downloadText(
        `${dataset.datasetId}.csv`,
        policyDatasetToCsv(dataset),
        "text/csv;charset=utf-8"
      );
      return;
    }
    setNotice("表示条件を更新しました。質問を送信すると新しい説明へ反映されます。");
  };

  return (
    <section className="explanation-workspace" aria-labelledby="explanation-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Step 3 · Explain</p>
          <h1 id="explanation-title">根拠から説明を組み立てる</h1>
          <p className="heading-copy">
            OpenUIは確認済みデータのIDを参照し、許可された部品だけで画面を構成します。
          </p>
        </div>
        <button className="button button-quiet" type="button" onClick={onBackToReview}>
          確認へ戻る
        </button>
      </div>
      <form
        className="prompt-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label>
          誰に向けた説明ですか
          <select
            value={audience}
            onChange={(event) =>
              setAudience(
                event.target.value as
                  | "resident"
                  | "staff"
                  | "council"
                  | "researcher"
              )
            }
          >
            <option value="resident">住民</option>
            <option value="staff">自治体職員</option>
            <option value="council">議員</option>
            <option value="researcher">研究者</option>
          </select>
        </label>
        <label className="prompt-field">
          質問
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            rows={3}
          />
        </label>
        <button className="button button-primary" type="submit" disabled={streaming}>
          {streaming ? "生成中…" : response ? "続けて質問" : "説明を生成"}
        </button>
      </form>
      {notice ? <p className="generation-notice" role="status">{notice}</p> : null}
      {error ? <p className="pipeline-error" role="alert">{error}</p> : null}
      {response ? (
        <>
        <div className="generation-toolbar" aria-label="説明の出力操作">
          <button
            type="button"
            onClick={() =>
              downloadText(
                `${dataset.datasetId}.json`,
                JSON.stringify(dataset, null, 2),
                "application/json"
              )
            }
          >
            JSON
          </button>
          <button
            type="button"
            onClick={() =>
              downloadText(
                `${dataset.datasetId}.csv`,
                policyDatasetToCsv(dataset),
                "text/csv;charset=utf-8"
              )
            }
          >
            CSV
          </button>
          <button
            type="button"
            onClick={() =>
              downloadText(
                `${dataset.datasetId}.html`,
                policyDatasetToHtml(dataset),
                "text/html;charset=utf-8"
              )
            }
          >
            HTML
          </button>
          <button
            type="button"
            onClick={() => void document.documentElement.requestFullscreen()}
          >
            フルスクリーン
          </button>
        </div>
        <div className="generated-view">
          <SafePolicyRenderer
            dataset={dataset}
            response={response}
            isStreaming={streaming}
            onAction={handleAction}
          />
        </div>
        </>
      ) : (
        <div className="generation-placeholder">
          <span>OpenUI</span>
          <h2>確認済みデータから、質問に合う画面を生成します。</h2>
          <p>任意HTMLやJavaScriptは実行されません。</p>
        </div>
      )}
    </section>
  );
}

function SourceViewer({
  dataset,
  request,
  onClose
}: {
  dataset: PolicyDataset | undefined;
  request: SourceRequest;
  onClose: () => void;
}) {
  const [sourceUrl, setSourceUrl] = useState<string>();
  const [loadError, setLoadError] = useState<string>();
  const document = dataset?.documents.find(({ id }) => id === request.documentId);

  useEffect(() => {
    let objectUrl: string | undefined;
    let active = true;
    setSourceUrl(undefined);
    setLoadError(undefined);
    void loadSourcePdf(request.documentId)
      .then((stored) => {
        if (!active) {
          return;
        }
        if (!stored) {
          setLoadError(
            "元のPDFはこのブラウザに保存されていません。PDFを再度読み込んでください。"
          );
          return;
        }
        objectUrl = URL.createObjectURL(stored.blob);
        setSourceUrl(`${objectUrl}#page=${request.pageNumber}`);
      })
      .catch((error) => {
        if (active) {
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [request.documentId, request.pageNumber]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="source-viewer-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="source-viewer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-viewer-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">Source · Page {request.pageNumber}</p>
            <h2 id="source-viewer-title">
              {document?.title ?? document?.fileName ?? "出典PDF"}
            </h2>
          </div>
          <button className="button button-quiet" type="button" onClick={onClose} autoFocus>
            閉じる
          </button>
        </header>
        {sourceUrl ? (
          <iframe
            src={sourceUrl}
            title={`${document?.fileName ?? "出典PDF"} ${request.pageNumber}ページ`}
          />
        ) : loadError ? (
          <div className="source-viewer-message" role="alert">
            <strong>PDFを表示できません</strong>
            <p>{loadError}</p>
          </div>
        ) : (
          <div className="source-viewer-message" role="status">
            <p>PDFを読み込み中…</p>
          </div>
        )}
      </section>
    </div>
  );
}

function LoadingScreen() {
  return (
    <main className="loading-screen" aria-busy="true">
      <span />
      <p>ローカルワークスペースを読み込み中…</p>
    </main>
  );
}

function findSelectedMetric(
  dataset: PolicyDataset | undefined,
  metricValueId: string | undefined
): SelectedMetric | undefined {
  if (!dataset || !metricValueId) {
    return undefined;
  }
  for (const indicator of dataset.indicators) {
    const value = indicator.values.find(({ id }) => id === metricValueId);
    if (value) {
      return { indicator, value };
    }
  }
  return undefined;
}

function policyDatasetToCsv(dataset: PolicyDataset): string {
  const rows = [
    ["indicator_id", "indicator_name", "value_id", "role", "value", "unit", "fiscal_year", "review_status"],
    ...dataset.indicators.flatMap((indicator) =>
      indicator.values.map((value) => [
        indicator.id,
        indicator.name,
        value.id,
        value.role,
        String(value.value),
        value.unit ?? "",
        value.fiscalYear ?? "",
        value.reviewStatus
      ])
    )
  ];
  return rows
    .map((row) =>
      row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")
    )
    .join("\n");
}

function downloadText(fileName: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function policyDatasetToHtml(dataset: PolicyDataset): string {
  const sections = dataset.indicators
    .map((indicator) => {
      const values = indicator.values
        .filter(({ reviewStatus }) =>
          ["confirmed", "corrected"].includes(reviewStatus)
        )
        .map(
          (value) =>
            `<li><strong>${escapeHtml(value.role)}</strong>: ${escapeHtml(String(value.value))} ${escapeHtml(value.unit ?? "")} (${escapeHtml(value.fiscalYear ?? "年度不明")})</li>`
        )
        .join("");
      return `<section><h2>${escapeHtml(indicator.name)}</h2><ul>${values}</ul></section>`;
    })
    .join("");
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>PolicyGOS Export</title><style>body{font-family:system-ui,sans-serif;max-width:860px;margin:40px auto;padding:0 20px;color:#17211d}section{border-top:1px solid #ccd3cf;padding:20px 0}li{margin:8px 0}</style></head><body><h1>PolicyGOS</h1>${sections}</body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[character]!
  );
}
