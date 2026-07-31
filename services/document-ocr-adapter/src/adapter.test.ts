import { describe, expect, it, vi } from "vitest";
import { OcrBackendClient } from "./client.js";
import { OcrAdapterError } from "./errors.js";
import { validatePdfUpload } from "./fileValidation.js";
import { normalizeOcrDocument } from "./normalize.js";

const rawDocument = {
  schema_version: "ocr-backend-v1",
  engine: { primary: "pymupdf", ocr: "tesseract" },
  classification: "digital_text_pdf",
  classification_confidence: 0.99,
  path_used: "pdf_text_fast_path",
  metadata: { title: "政策評価" },
  pages: [
    {
      page_number: 1,
      text: "目標 80",
      layout_text: "目標 80",
      text_blocks: [
        { text: "目標 80", bbox: [10, 20, 80, 40], source: "pymupdf" }
      ],
      tables: [
        {
          table_index: 1,
          bbox: [10, 50, 200, 100],
          row_count: 1,
          col_count: 2,
          rows: [["目標", "80"]],
          cells: [
            { row: 0, col: 0, text: "目標" },
            { row: 0, col: 1, text: "80" }
          ],
          source: "pymupdf"
        }
      ],
      char_count: 4,
      extraction_mode: "digital",
      ocr_engine: null
    }
  ],
  summary: { page_count: 1, table_count: 1 }
};

describe("PDF validation", () => {
  it("checks extension, MIME and magic bytes", () => {
    expect(() =>
      validatePdfUpload(
        "evaluation.pdf",
        "application/pdf",
        new TextEncoder().encode("%PDF-1.7")
      )
    ).not.toThrow();
    expect(() =>
      validatePdfUpload(
        "evaluation.pdf",
        "application/pdf",
        new TextEncoder().encode("<html>")
      )
    ).toThrowError(OcrAdapterError);
  });
});

describe("OCR normalization", () => {
  it("preserves pages, blocks, tables and coordinates", () => {
    const normalized = normalizeOcrDocument(rawDocument);
    expect(normalized.pages[0]?.blocks[0]?.bbox).toEqual([10, 20, 80, 40]);
    expect(normalized.pages[0]?.tables[0]).toMatchObject({
      id: "page-1-table-1",
      bbox: [10, 50, 200, 100],
      rows: [["目標", "80"]]
    });
  });
});

describe("OCR backend identity", () => {
  it("fails closed when the endpoint is not the expected backend", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          status: "healthy",
          version: "1",
          yomitoku_available: true,
          ocr_backend_available: true,
          primary_engine: "other",
          ocr_engine: null
        })
      )
      .mockResolvedValueOnce(
        Response.json({ input_formats: ["pdf"], output_formats: ["json"] })
      );
    const client = new OcrBackendClient({
      baseUrl: "http://ocr.test",
      fetch: fetchMock
    });
    await expect(client.assertIdentity()).rejects.toMatchObject({
      code: "wrong_backend"
    });
  });

  it("does not contact the backend for an invalid upload", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = new OcrBackendClient({
      baseUrl: "http://ocr.test",
      fetch: fetchMock
    });
    await expect(
      client.analyzeSync({
        fileName: "not-a-pdf.pdf",
        mimeType: "application/pdf",
        bytes: new TextEncoder().encode("not pdf")
      })
    ).rejects.toMatchObject({ code: "invalid_file" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
