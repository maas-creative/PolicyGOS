import { OcrAdapterError } from "./errors.js";

const PDF_MAGIC = new TextEncoder().encode("%PDF-");

export function validatePdfUpload(
  fileName: string,
  mimeType: string,
  bytes: Uint8Array
): void {
  if (!fileName.toLowerCase().endsWith(".pdf")) {
    throw new OcrAdapterError("invalid_file", "Only .pdf files are accepted");
  }
  if (mimeType.toLowerCase() !== "application/pdf") {
    throw new OcrAdapterError("invalid_file", "MIME type must be application/pdf");
  }
  if (
    bytes.length < PDF_MAGIC.length ||
    PDF_MAGIC.some((byte, index) => bytes[index] !== byte)
  ) {
    throw new OcrAdapterError("invalid_file", "File does not have a PDF signature");
  }
}
