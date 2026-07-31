import {
  GeminiStructuredOutputProvider,
  OllamaStructuredOutputProvider,
  OpenAiStructuredOutputProvider,
  type ReportMetaProvider
} from "@policygos/reportmeta";

export interface ServerConfig {
  host: string;
  port: number;
  deployment: "local" | "public";
  ocrBackendUrl: string;
  ocrApiToken: string;
  localOnly: boolean;
  accessTokens: ReadonlyMap<string, string>;
  rateLimitPerMinute: number;
  maxConcurrentOcr: number;
  auditLogPath: string;
  reportMetaProvider: "local" | "openai" | "gemini" | "ollama";
  reportMetaModel: string;
  reportMetaProviderHost: string;
  openUiModel: string;
  openAiBaseUrl: string;
  openAiApiKey: string;
  openAiModel: string;
}

export function readServerConfig(
  environment: NodeJS.ProcessEnv = process.env
): ServerConfig {
  const deployment = readDeployment(environment.POLICYGOS_DEPLOYMENT);
  const reportMetaProvider = readProviderKind(environment.REPORTMETA_PROVIDER);
  const openAiBaseUrl =
    environment.OPENAI_BASE_URL ?? "http://127.0.0.1:1234/v1";
  const ollamaBaseUrl =
    environment.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
  const reportMetaModel =
    reportMetaProvider === "gemini"
      ? environment.GEMINI_MODEL ?? "not-configured"
      : reportMetaProvider === "ollama"
        ? environment.OLLAMA_MODEL ?? "not-configured"
        : environment.OPENAI_MODEL ?? "qwen/qwen3.6-27b";
  const providerUrl =
    reportMetaProvider === "gemini"
      ? "https://generativelanguage.googleapis.com"
      : reportMetaProvider === "ollama"
        ? ollamaBaseUrl
        : openAiBaseUrl;
  const accessTokens = readAccessTokens(environment.POLICYGOS_ACCESS_TOKENS);
  const ocrApiToken = environment.OCR_API_TOKEN ?? "";
  const localOnly = (environment.POLICYGOS_LOCAL_ONLY ?? "true") !== "false";
  assertProviderAllowed(providerUrl, localOnly);
  assertProviderAllowed(openAiBaseUrl, localOnly);
  if (deployment === "public") {
    if (accessTokens.size === 0) {
      throw new Error(
        "POLICYGOS_ACCESS_TOKENS is required for public deployment"
      );
    }
    if ([...accessTokens.values()].some((token) => token.length < 32)) {
      throw new Error("Public access tokens must be at least 32 characters");
    }
    if (ocrApiToken.length < 32) {
      throw new Error("OCR_API_TOKEN must be at least 32 characters in public deployment");
    }
    if (!environment.OPENAI_MODEL && !environment.OPENUI_MODEL) {
      throw new Error("OPENAI_MODEL or OPENUI_MODEL is required in public deployment");
    }
    if (!isLoopbackUrl(openAiBaseUrl) && !environment.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is required for a remote OpenAI-compatible provider");
    }
    if (
      reportMetaProvider === "gemini" &&
      (!environment.GEMINI_API_KEY || !environment.GEMINI_MODEL)
    ) {
      throw new Error("GEMINI_API_KEY and GEMINI_MODEL are required");
    }
    if (reportMetaProvider === "ollama" && !environment.OLLAMA_MODEL) {
      throw new Error("OLLAMA_MODEL is required");
    }
    if (
      (reportMetaProvider === "gemini" || reportMetaProvider === "ollama") &&
      !environment.OPENUI_MODEL
    ) {
      throw new Error("OPENUI_MODEL is required when ReportMeta uses another provider");
    }
  }
  return {
    host:
      environment.POLICYGOS_HOST ??
      (deployment === "public" ? "0.0.0.0" : "127.0.0.1"),
    port: Number(environment.POLICYGOS_PORT ?? "8787"),
    deployment,
    ocrBackendUrl: environment.OCR_BACKEND_URL ?? "http://127.0.0.1:8000",
    ocrApiToken,
    localOnly,
    accessTokens,
    rateLimitPerMinute: readPositiveInteger(
      environment.POLICYGOS_RATE_LIMIT_PER_MINUTE,
      30,
      "POLICYGOS_RATE_LIMIT_PER_MINUTE"
    ),
    maxConcurrentOcr: readPositiveInteger(
      environment.POLICYGOS_MAX_CONCURRENT_OCR,
      2,
      "POLICYGOS_MAX_CONCURRENT_OCR"
    ),
    auditLogPath: environment.POLICYGOS_AUDIT_LOG_PATH ?? "",
    reportMetaProvider,
    reportMetaModel,
    reportMetaProviderHost: new URL(providerUrl).origin,
    openUiModel: environment.OPENUI_MODEL ?? reportMetaModel,
    openAiBaseUrl,
    openAiApiKey: environment.OPENAI_API_KEY ?? "local",
    openAiModel: environment.OPENAI_MODEL ?? "qwen/qwen3.6-27b"
  };
}

function isLoopbackUrl(value: string): boolean {
  const hostname = new URL(value).hostname;
  return ["127.0.0.1", "localhost", "::1"].includes(hostname);
}

function readDeployment(value: string | undefined): ServerConfig["deployment"] {
  const deployment = value ?? "local";
  if (deployment === "local" || deployment === "public") {
    return deployment;
  }
  throw new Error(`Unsupported POLICYGOS_DEPLOYMENT: ${deployment}`);
}

function readAccessTokens(value: string | undefined): ReadonlyMap<string, string> {
  if (!value) {
    return new Map();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("POLICYGOS_ACCESS_TOKENS must be a JSON object");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new Error("POLICYGOS_ACCESS_TOKENS must be a JSON object");
  }
  const entries = Object.entries(parsed);
  if (
    entries.some(
      ([subject, token]) =>
        subject.trim().length === 0 ||
        typeof token !== "string" ||
        token.length === 0
    )
  ) {
    throw new Error("Access token subjects and values must not be empty");
  }
  if (new Set(entries.map(([, token]) => token)).size !== entries.length) {
    throw new Error("Each access token must identify exactly one subject");
  }
  return new Map(entries as Array<[string, string]>);
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string
): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function createReportMetaProvider(
  environment: NodeJS.ProcessEnv = process.env
): ReportMetaProvider {
  const config = readServerConfig(environment);
  const provider = config.reportMetaProvider;
  if (provider === "gemini") {
    assertProviderAllowed(config.reportMetaProviderHost, config.localOnly);
    const apiKey = required(environment.GEMINI_API_KEY, "GEMINI_API_KEY");
    return new GeminiStructuredOutputProvider({
      apiKey,
      model: required(environment.GEMINI_MODEL, "GEMINI_MODEL")
    });
  }
  if (provider === "ollama") {
    const baseUrl = environment.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
    assertProviderAllowed(baseUrl, config.localOnly);
    return new OllamaStructuredOutputProvider({
      baseUrl,
      model: required(environment.OLLAMA_MODEL, "OLLAMA_MODEL")
    });
  }
  assertProviderAllowed(config.openAiBaseUrl, config.localOnly);
  return new OpenAiStructuredOutputProvider({
    baseUrl: config.openAiBaseUrl,
    apiKey: config.openAiApiKey,
    model: config.openAiModel,
    api: provider === "openai" ? "responses" : "chat-completions"
  });
}

export function assertProviderAllowed(baseUrl: string, localOnly: boolean): void {
  if (!localOnly) {
    return;
  }
  if (!isLoopbackUrl(baseUrl)) {
    throw new Error(
      "POLICYGOS_LOCAL_ONLY blocks sending documents to a remote provider"
    );
  }
}

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function readProviderKind(
  value: string | undefined
): ServerConfig["reportMetaProvider"] {
  const provider = value ?? "local";
  if (
    provider === "local" ||
    provider === "openai" ||
    provider === "gemini" ||
    provider === "ollama"
  ) {
    return provider;
  }
  throw new Error(`Unsupported REPORTMETA_PROVIDER: ${provider}`);
}
