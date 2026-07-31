import { describe, expect, it } from "vitest";
import { createPolicyApi } from "./app.js";
import {
  assertProviderAllowed,
  createReportMetaProvider,
  readServerConfig
} from "./config.js";

describe("PolicyGOS API", () => {
  it("reports local-only runtime state", async () => {
    const app = createPolicyApi(readServerConfig({}));
    const healthResponse = await app.request("/api/health");
    expect(healthResponse.status).toBe(200);
    await expect(healthResponse.json()).resolves.toEqual({
      status: "healthy",
      service: "policygos-openui-api",
      authRequired: false
    });
    expect(healthResponse.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'"
    );

    const response = await app.request("/api/runtime");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      service: "policygos-openui-api",
      deployment: "local",
      localOnly: true,
      reportMeta: {
        provider: "local",
        model: "qwen/qwen3.6-27b",
        host: "http://127.0.0.1:1234"
      },
      openUi: {
        model: "qwen/qwen3.6-27b",
        host: "http://127.0.0.1:1234"
      },
      ocr: { host: "http://127.0.0.1:8000" },
      retention: {
        server: "request-only",
        browser: "until-workspace-is-cleared"
      }
    });
  });

  it("requires a named bearer token in public deployment", async () => {
    const token = "a".repeat(64);
    const config = readServerConfig({
      POLICYGOS_DEPLOYMENT: "public",
      POLICYGOS_ACCESS_TOKENS: JSON.stringify({ reviewer: token }),
      OCR_API_TOKEN: "b".repeat(64),
      OPENAI_MODEL: "test-model"
    });
    const app = createPolicyApi(config, {
      writeAudit: async () => undefined
    });

    const health = await app.request("/api/health");
    await expect(health.json()).resolves.toMatchObject({ authRequired: true });

    const denied = await app.request("/api/runtime");
    expect(denied.status).toBe(401);

    const session = await app.request("/api/session", {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(session.status).toBe(200);
    await expect(session.json()).resolves.toEqual({ subject: "reviewer" });
  });

  it("fails closed when public deployment secrets are missing", () => {
    expect(() =>
      readServerConfig({ POLICYGOS_DEPLOYMENT: "public" })
    ).toThrow("POLICYGOS_ACCESS_TOKENS");
  });

  it("rejects non-PDF upload content before contacting OCR", async () => {
    const fetchImpl = async () => {
      throw new Error("OCR must not be called");
    };
    const app = createPolicyApi(readServerConfig({}), {
      fetch: fetchImpl as typeof fetch
    });
    const form = new FormData();
    form.set(
      "file",
      new File(["not a pdf"], "spoofed.pdf", { type: "application/pdf" })
    );

    const response = await app.request("/api/ocr/analyze", {
      method: "POST",
      body: form
    });

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toEqual({
      error: "Uploaded file is not a PDF"
    });
  });

  it("blocks remote providers in local-only mode", () => {
    expect(() =>
      assertProviderAllowed("https://api.example.test/v1", true)
    ).toThrow("POLICYGOS_LOCAL_ONLY");
    expect(() =>
      assertProviderAllowed("http://127.0.0.1:1234/v1", true)
    ).not.toThrow();
  });

  it("blocks explicitly remote Gemini processing in local-only mode", () => {
    expect(() =>
      createReportMetaProvider({
        REPORTMETA_PROVIDER: "gemini",
        POLICYGOS_LOCAL_ONLY: "true",
        GEMINI_API_KEY: "test",
        GEMINI_MODEL: "test"
      })
    ).toThrow("POLICYGOS_LOCAL_ONLY");
  });
});
