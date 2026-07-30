import { ReportMetaError } from "./errors.js";

export async function postJson(
  fetchImpl: typeof fetch,
  url: string,
  headers: HeadersInit,
  body: unknown,
  signal?: AbortSignal
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {})
    });
  } catch (error) {
    throw new ReportMetaError(
      "provider_network",
      "Structured output provider request failed",
      { cause: error }
    );
  }

  if (!response.ok) {
    throw new ReportMetaError(
      "provider_response",
      `Structured output provider returned HTTP ${response.status}`
    );
  }
  try {
    return await response.json();
  } catch (error) {
    throw new ReportMetaError(
      "provider_response",
      "Structured output provider did not return JSON",
      { cause: error }
    );
  }
}

export function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ReportMetaError(
      "provider_response",
      "Structured output provider returned invalid JSON content",
      { cause: error }
    );
  }
}
