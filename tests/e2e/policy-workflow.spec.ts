import { expect, test } from "@playwright/test";
import { buildPolicyDatasetFixture } from "../../packages/policy-schema/src/fixtures.js";
import { fileURLToPath } from "node:url";

const fixturePdfPath = fileURLToPath(
  new URL(
    "../../fixtures/policy-documents/walking-skeleton-policy-evaluation.pdf",
    import.meta.url
  )
);

test("PDFから根拠確認、保存、OpenUI説明まで完了する", async ({ page }) => {
  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        status: "healthy",
        service: "policygos-openui-api",
        localOnly: true,
        reportMeta: {
          provider: "local",
          model: "deterministic",
          host: "http://127.0.0.1:1234"
        },
        openUi: {
          model: "deterministic",
          host: "http://127.0.0.1:1234"
        },
        ocr: { host: "http://127.0.0.1:8000" },
        retention: {
          server: "request-only",
          browser: "until-workspace-is-cleared"
        }
      })
    });
  });
  await page.route("**/api/ocr/analyze", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: "reportmeta-ocr-input-v1",
        sourceSchemaVersion: "ocr-backend-v1",
        classification: "digital_text_pdf",
        extractionPath: "pdf_text_fast_path",
        engine: { primary: "pymupdf", ocr: null },
        metadata: {},
        pages: [
          {
            pageNumber: 1,
            text: "成果指標の目標値は80%とする。",
            layoutText: "成果指標の目標値は80%とする。",
            extractionMode: "digital",
            ocrEngine: null,
            blocks: [],
            tables: []
          },
          {
            pageNumber: 2,
            text: "令和7年度の実績値は76%であった。",
            layoutText: "令和7年度の実績値は76%であった。",
            extractionMode: "digital",
            ocrEngine: null,
            blocks: [],
            tables: []
          }
        ]
      })
    });
  });

  await page.route("**/api/reportmeta/extract", async (route) => {
    const request = route.request().postDataJSON() as {
      documents: Array<{ documentId: string; fileName: string }>;
    };
    const source = request.documents[0]!;
    const fixture = buildPolicyDatasetFixture();
    const dataset = {
      ...fixture,
      documents: fixture.documents.map((document) => ({
        ...document,
        id: source.documentId,
        fileName: source.fileName
      })),
      evidence: fixture.evidence.map((item) => ({
        ...item,
        documentId: source.documentId
      }))
    };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        dataset,
        provider: {
          name: "e2e-fixture",
          model: "deterministic",
          durationMs: 1
        }
      })
    });
  });

  await page.route("**/api/openui/generate", async (route) => {
    await route.fulfill({
      contentType: "text/plain; charset=utf-8",
      body: [
        'root = PolicySummary("確認済みデータ", "project-1", [comparison, explanation, source])',
        'comparison = MetricComparison("indicator-1", ["metric-target", "metric-actual"])',
        'explanation = AudienceExplanation("resident", "目標と実績", "実績を根拠とともに確認できます。", ["evidence-target", "evidence-actual"])',
        'source = SourceLink("evidence-actual", "実績の出典を開く")'
      ].join("\n")
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "データ取扱い" }).click();
  const dataHandling = page.getByRole("dialog", { name: "文書の送信先と保持" });
  await expect(dataHandling).toContainText("ローカル限定モード");
  await expect(dataHandling).toContainText("http://127.0.0.1:8000");
  await expect(dataHandling).toContainText("IndexedDB");
  await dataHandling.getByRole("button", { name: "閉じる" }).click();
  await page.getByLabel("PDFを選択").setInputFiles(fixturePdfPath);

  await expect(page.getByRole("heading", { name: "抽出結果を確認" })).toBeVisible();
  const actualCard = page.locator(".metric-card").filter({ hasText: "76" });
  await actualCard.click();
  await actualCard.getByRole("button", { name: "根拠と一致" }).click();
  await expect(page.getByLabel("2/2件確認済み")).toBeVisible();

  await page.getByRole("button", { name: "p. 2 を開く" }).click();
  const sourceDialog = page.getByRole("dialog", { name: /政策評価書/ });
  await expect(sourceDialog).toBeVisible();
  await expect(sourceDialog.locator("iframe")).toHaveAttribute("src", /#page=2$/);
  await sourceDialog.getByRole("button", { name: "閉じる" }).click();

  await page.getByRole("button", { name: "説明を作る" }).click();
  const generationResponse = page.waitForResponse("**/api/openui/generate");
  await page.getByRole("button", { name: "説明を生成" }).click();
  expect((await generationResponse).ok()).toBe(true);
  await expect(
    page.getByRole("button", { name: "続けて質問" })
  ).toBeVisible({ timeout: 15_000 });
  const generatedView = page.locator(".generated-view");
  await expect(
    generatedView.getByRole("heading", { name: "地域移動支援事業" })
  ).toBeVisible();
  await expect(generatedView.getByText(/80\s*%/)).toBeVisible();
  await expect(generatedView.getByText(/76\s*%/)).toBeVisible();
  await expect(generatedView.getByText("目標と実績")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "抽出結果を確認" })).toBeVisible();
  await expect(page.getByLabel("2/2件確認済み")).toBeVisible();
  await page.locator(".metric-card").filter({ hasText: "76" }).click();
  await page.getByRole("button", { name: "p. 2 を開く" }).click();
  await expect(page.getByRole("dialog").locator("iframe")).toHaveAttribute(
    "src",
    /#page=2$/
  );
});
