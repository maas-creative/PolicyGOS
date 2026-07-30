export type OcrAdapterErrorCode =
  | "invalid_file"
  | "wrong_backend"
  | "network"
  | "timeout"
  | "cancelled"
  | "backend"
  | "invalid_response";

export class OcrAdapterError extends Error {
  constructor(
    public readonly code: OcrAdapterErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "OcrAdapterError";
  }
}
