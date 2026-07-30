import {
  GeminiStructuredOutputProvider,
  OllamaStructuredOutputProvider,
  OpenAiStructuredOutputProvider,
  type ReportMetaProvider
} from "@policygos/reportmeta";

export interface ServerConfig {
  host: string;
  port: number;
  ocrBackendUrl: string;
  localOnly: boolean;
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
  return {
    host: environment.POLICYGOS_HOST ?? "127.0.0.1",
    port: Number(environment.POLICYGOS_PORT ?? "8787"),
    ocrBackendUrl: environment.OCR_BACKEND_URL ?? "http://127.0.0.1:8000",
    localOnly: (environment.POLICYGOS_LOCAL_ONLY ?? "true") !== "false",
    reportMetaProvider,
    reportMetaModel,
    reportMetaProviderHost: new URL(providerUrl).origin,
    openUiModel: environment.OPENUI_MODEL ?? reportMetaModel,
    openAiBaseUrl,
    openAiApiKey: environment.OPENAI_API_KEY ?? "local",
    openAiModel: environment.OPENAI_MODEL ?? "qwen/qwen3.6-27b"
  };
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
  const hostname = new URL(baseUrl).hostname;
  if (!["127.0.0.1", "localhost", "::1"].includes(hostname)) {
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
