import { buildPolicyDatasetFixture } from "@policygos/policy-schema";
import { describe, expect, it, vi } from "vitest";
import { ReportMetaError } from "./errors.js";
import { extractPolicyDataset } from "./extract.js";
import { buildReportMetaPrompt } from "./prompt.js";
import { OpenAiStructuredOutputProvider } from "./providers/openai.js";
import type {
  ReportMetaExtractionRequest,
  ReportMetaProvider
} from "./types.js";

const request: ReportMetaExtractionRequest = {
  documents: [
    {
      documentId: "document-1",
      fileName: "evaluation.pdf",
      ocr: {
        schemaVersion: "reportmeta-ocr-input-v1",
        sourceSchemaVersion: "ocr-backend-v1",
        classification: "digital_text_pdf",
        extractionPath: "pdf_text_fast_path",
        engine: { primary: "pymupdf", ocr: null },
        metadata: {},
        pages: [
          {
            pageNumber: 1,
            text: "地域移動支援事業。地域の移動手段を確保する。住民。利用者満足度。成果指標の目標値は80%とする。",
            layoutText: "地域移動支援事業。地域の移動手段を確保する。住民。利用者満足度。成果指標の目標値は80%とする。",
            extractionMode: "digital",
            ocrEngine: null,
            blocks: [],
            tables: []
          },
          {
            pageNumber: 2,
            text: "地域移動支援事業。利用者満足度。令和7年度の実績値は76%であった。",
            layoutText: "地域移動支援事業。利用者満足度。令和7年度の実績値は76%であった。",
            extractionMode: "digital",
            ocrEngine: null,
            blocks: [],
            tables: []
          }
        ]
      }
    }
  ]
};

describe("ReportMeta extraction", () => {
  it("validates provider output and records execution metadata", async () => {
    const provider: ReportMetaProvider = {
      name: "fixture",
      generate: vi.fn().mockResolvedValue({
        value: {
          ...buildPolicyDatasetFixture(),
          documents: [
            {
              ...buildPolicyDatasetFixture().documents[0],
              id: "document-1"
            }
          ]
        },
        model: "fixture-model",
        inputTokens: 100,
        outputTokens: 200,
        finishReason: "completed"
      })
    };
    const result = await extractPolicyDataset(request, provider);
    expect(result.dataset.schemaVersion).toBe("policy-dataset-v1");
    expect(result.dataset.indicators[0]?.values[1]?.fiscalYear).toBe(
      "令和7年度"
    );
    expect(result.provider).toMatchObject({
      name: "fixture",
      model: "fixture-model",
      inputTokens: 100,
      outputTokens: 200,
      cost: null
    });
  });

  it("derives evidence coordinates and table location from OCR, not provider output", async () => {
    const fixture = buildPolicyDatasetFixture();
    const requestWithGeometry: ReportMetaExtractionRequest = {
      documents: [
        {
          ...request.documents[0]!,
          ocr: {
            ...request.documents[0]!.ocr,
            pages: request.documents[0]!.ocr.pages.map((page) =>
              page.pageNumber === 1
                ? {
                    ...page,
                    blocks: [
                      {
                        text: "成果指標の目標値は80%とする。",
                        bbox: [11, 22, 211, 44],
                        source: "pymupdf"
                      }
                    ],
                    tables: [
                      {
                        id: "page-1-table-1",
                        bbox: [5, 10, 250, 80],
                        rowCount: 1,
                        columnCount: 1,
                        rows: [["成果指標の目標値は80%とする。"]],
                        cells: [
                          {
                            row: 0,
                            column: 0,
                            text: "成果指標の目標値は80%とする。",
                            bbox: [12, 23, 210, 43]
                          }
                        ],
                        source: "pymupdf"
                      }
                    ]
                  }
                : page
            )
          }
        }
      ]
    };
    const provider: ReportMetaProvider = {
      name: "fixture",
      generate: vi.fn().mockResolvedValue({
        value: {
          ...fixture,
          documents: [{ ...fixture.documents[0], id: "document-1" }],
          evidence: fixture.evidence.map((item) => ({
            ...item,
            boundingBox: { x0: 999, y0: 999, x1: 1000, y1: 1000 }
          }))
        },
        model: "fixture-model",
        finishReason: "completed"
      })
    };

    const result = await extractPolicyDataset(requestWithGeometry, provider);
    expect(result.dataset.evidence[0]).toMatchObject({
      boundingBox: { x0: 12, y0: 23, x1: 210, y1: 43 },
      table: { tableId: "page-1-table-1", row: 0, column: 0 }
    });
    expect(result.dataset.evidence[1]?.boundingBox).toBeUndefined();
  });

  it("accepts and preserves multiple supplied document identities", async () => {
    const fixture = buildPolicyDatasetFixture();
    const secondDocument = {
      ...request.documents[0]!,
      documentId: "document-2",
      fileName: "settlement.pdf"
    };
    const provider: ReportMetaProvider = {
      name: "fixture",
      generate: vi.fn().mockResolvedValue({
        value: {
          ...fixture,
          documents: [
            { ...fixture.documents[0], id: "document-1" },
            {
              ...fixture.documents[0],
              id: "document-2",
              fileName: "settlement.pdf"
            }
          ]
        },
        model: "fixture-model",
        cost: 0,
        finishReason: "completed"
      })
    };

    const result = await extractPolicyDataset(
      { documents: [...request.documents, secondDocument] },
      provider
    );
    expect(result.dataset.documents.map(({ id }) => id)).toEqual([
      "document-1",
      "document-2"
    ]);
    expect(result.provider.cost).toBe(0);
  });

  it("does not treat invalid structured output as success", async () => {
    const provider: ReportMetaProvider = {
      name: "broken",
      generate: vi.fn().mockResolvedValue({
        value: { schemaVersion: "policy-dataset-v1" },
        model: "broken-model",
        finishReason: "completed"
      })
    };
    await expect(extractPolicyDataset(request, provider)).rejects.toMatchObject({
      code: "schema_validation"
    });
  });

  it("repairs a dangling metric evidence reference from the quoted value", async () => {
    const fixture = buildPolicyDatasetFixture();
    const provider: ReportMetaProvider = {
      name: "repairable",
      generate: vi.fn().mockResolvedValue({
        value: {
          ...fixture,
          indicators: fixture.indicators.map((indicator) => ({
            ...indicator,
            evidenceIds: ["evidence-target", "invented-evidence-id"],
            values: indicator.values.map((value) =>
              value.id === "metric-actual"
                ? { ...value, evidenceIds: ["invented-evidence-id"] }
                : value
            )
          }))
        },
        model: "repairable-model",
        finishReason: "completed"
      })
    };
    const result = await extractPolicyDataset(request, provider);
    expect(result.dataset.indicators[0]?.values[1]?.evidenceIds).toEqual([
      "evidence-actual"
    ]);
  });

  it("rejects provider output that changes the supplied document identity", async () => {
    const provider: ReportMetaProvider = {
      name: "broken",
      generate: vi.fn().mockResolvedValue({
        value: {
          ...buildPolicyDatasetFixture(),
          documents: [
            {
              ...buildPolicyDatasetFixture().documents[0],
              id: "invented-document"
            }
          ],
          evidence: buildPolicyDatasetFixture().evidence.map((item) => ({
            ...item,
            documentId: "invented-document"
          }))
        },
        model: "broken-model",
        finishReason: "completed"
      })
    };
    await expect(extractPolicyDataset(request, provider)).rejects.toMatchObject({
      code: "schema_validation"
    });
  });

  it("isolates untrusted OCR text in the prompt", () => {
    const prompt = buildReportMetaPrompt(request);
    expect(prompt).toContain("<untrusted_documents>");
    expect(prompt).toContain('<page number="1">');
    expect(prompt).toContain("成果指標の目標値は80%とする。");
  });
});

describe("OpenAI provider", () => {
  it("fails closed on a refusal", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        status: "completed",
        model: "test-model",
        output: [
          {
            type: "message",
            content: [{ type: "refusal", refusal: "cannot process" }]
          }
        ]
      })
    );
    const provider = new OpenAiStructuredOutputProvider({
      baseUrl: "https://api.test/v1",
      apiKey: "test",
      model: "test-model",
      fetch: fetchMock
    });
    await expect(
      provider.generate({
        system: "system",
        prompt: "prompt",
        jsonSchema: { type: "object" }
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<ReportMetaError>>({
        code: "provider_refusal"
      })
    );
  });

  it("accepts structured output returned in a local model reasoning field", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        model: "local-reasoning-model",
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: "",
              reasoning_content: "{\"value\":76}"
            }
          }
        ]
      })
    );
    const provider = new OpenAiStructuredOutputProvider({
      baseUrl: "http://127.0.0.1:1234/v1",
      apiKey: "local",
      model: "local-reasoning-model",
      api: "chat-completions",
      fetch: fetchMock
    });
    await expect(
      provider.generate({
        system: "system",
        prompt: "prompt",
        jsonSchema: { type: "object" }
      })
    ).resolves.toMatchObject({
      value: { value: 76 },
      model: "local-reasoning-model"
    });
  });
});
