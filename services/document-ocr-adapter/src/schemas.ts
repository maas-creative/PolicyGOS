import { z } from "zod";

const bboxTupleSchema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite()
]);

export const healthResponseSchema = z
  .object({
    status: z.string(),
    version: z.string(),
    yomitoku_available: z.boolean(),
    ocr_backend_available: z.boolean(),
    primary_engine: z.string(),
    ocr_engine: z.string().nullable()
  })
  .passthrough();

export const formatsResponseSchema = z
  .object({
    input_formats: z.array(z.string()),
    output_formats: z.array(z.string())
  })
  .passthrough();

const rawTextBlockSchema = z
  .object({
    text: z.string(),
    bbox: bboxTupleSchema,
    source: z.string()
  })
  .passthrough();

const rawTableCellSchema = z
  .object({
    row: z.number().int().nonnegative(),
    col: z.number().int().nonnegative(),
    text: z.string().optional(),
    contents: z.string().optional(),
    bbox: bboxTupleSchema.optional()
  })
  .passthrough();

const rawTableSchema = z
  .object({
    table_index: z.number().int().positive(),
    bbox: bboxTupleSchema.optional(),
    row_count: z.number().int().nonnegative(),
    col_count: z.number().int().nonnegative(),
    rows: z.array(z.array(z.string())).default([]),
    cells: z.array(rawTableCellSchema).default([]),
    source: z.string()
  })
  .passthrough();

const rawPageSchema = z
  .object({
    page_number: z.number().int().positive(),
    text: z.string(),
    layout_text: z.string(),
    text_blocks: z.array(rawTextBlockSchema).default([]),
    tables: z.array(rawTableSchema).default([]),
    extraction_mode: z.string(),
    ocr_engine: z.string().nullable().optional()
  })
  .passthrough();

export const rawOcrDocumentSchema = z
  .object({
    schema_version: z.literal("ocr-backend-v1"),
    engine: z
      .object({
        primary: z.string(),
        ocr: z.string().nullable()
      })
      .passthrough(),
    classification: z.string(),
    classification_confidence: z.number().optional(),
    path_used: z.string(),
    metadata: z.record(z.string(), z.unknown()).default({}),
    pages: z.array(rawPageSchema),
    summary: z
      .object({
        page_count: z.number().int().nonnegative()
      })
      .passthrough()
  })
  .passthrough();

export const analysisResponseSchema = z
  .object({
    success: z.boolean(),
    format: z.string(),
    result: z.string().nullable(),
    error: z.string().nullable(),
    pages: z.number().int().nonnegative(),
    processing_time_ms: z.number().int().nonnegative()
  })
  .passthrough();

export const jobSubmitResponseSchema = z
  .object({
    job_id: z.string().min(1),
    status: z.string(),
    message: z.string()
  })
  .passthrough();

export const jobStatusSchema = z
  .object({
    job_id: z.string().min(1),
    status: z.string(),
    progress: z.number(),
    message: z.string(),
    result: z.string().nullable().optional(),
    error: z.string().nullable().optional()
  })
  .passthrough();

export const normalizedOcrDocumentSchema = z.object({
  schemaVersion: z.literal("reportmeta-ocr-input-v1"),
  sourceSchemaVersion: z.literal("ocr-backend-v1"),
  classification: z.string(),
  extractionPath: z.string(),
  engine: z.object({
    primary: z.string(),
    ocr: z.string().nullable()
  }),
  metadata: z.record(z.string(), z.unknown()),
  pages: z.array(
    z.object({
      pageNumber: z.number().int().positive(),
      text: z.string(),
      layoutText: z.string(),
      extractionMode: z.string(),
      ocrEngine: z.string().nullable(),
      blocks: z.array(
        z.object({
          text: z.string(),
          bbox: bboxTupleSchema,
          source: z.string()
        })
      ),
      tables: z.array(
        z.object({
          id: z.string(),
          bbox: bboxTupleSchema.optional(),
          rowCount: z.number().int().nonnegative(),
          columnCount: z.number().int().nonnegative(),
          rows: z.array(z.array(z.string())),
          cells: z.array(
            z.object({
              row: z.number().int().nonnegative(),
              column: z.number().int().nonnegative(),
              text: z.string(),
              bbox: bboxTupleSchema.optional()
            })
          ),
          source: z.string()
        })
      )
    })
  )
});

export type RawOcrDocument = z.infer<typeof rawOcrDocumentSchema>;
export type NormalizedOcrDocument = z.infer<typeof normalizedOcrDocumentSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
