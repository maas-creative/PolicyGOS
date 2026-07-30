export type ReportMetaErrorCode =
  | "invalid_request"
  | "provider_network"
  | "provider_response"
  | "provider_refusal"
  | "schema_validation";

export class ReportMetaError extends Error {
  constructor(
    public readonly code: ReportMetaErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "ReportMetaError";
  }
}
