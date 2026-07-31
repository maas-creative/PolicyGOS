import {
  normalizedOcrDocumentSchema,
  rawOcrDocumentSchema,
  type NormalizedOcrDocument
} from "./schemas.js";

export function normalizeOcrDocument(input: unknown): NormalizedOcrDocument {
  const document = rawOcrDocumentSchema.parse(input);
  return normalizedOcrDocumentSchema.parse({
    schemaVersion: "reportmeta-ocr-input-v1",
    sourceSchemaVersion: document.schema_version,
    classification: document.classification,
    extractionPath: document.path_used,
    engine: document.engine,
    metadata: document.metadata,
    pages: document.pages.map((page) => ({
      pageNumber: page.page_number,
      text: page.text,
      layoutText: page.layout_text,
      extractionMode: page.extraction_mode,
      ocrEngine: page.ocr_engine ?? null,
      blocks: page.text_blocks.map((block) => ({
        text: block.text,
        bbox: block.bbox,
        source: block.source
      })),
      tables: page.tables.map((table) => ({
        id: `page-${page.page_number}-table-${table.table_index}`,
        ...(table.bbox ? { bbox: table.bbox } : {}),
        rowCount: table.row_count,
        columnCount: table.col_count,
        rows: table.rows,
        cells: table.cells.map((cell) => ({
          row: cell.row,
          column: cell.col,
          text: cell.text ?? cell.contents ?? "",
          ...(cell.bbox ? { bbox: cell.bbox } : {})
        })),
        source: table.source
      }))
    }))
  });
}

export function parseBackendResult(result: string): NormalizedOcrDocument {
  return normalizeOcrDocument(JSON.parse(result) as unknown);
}
