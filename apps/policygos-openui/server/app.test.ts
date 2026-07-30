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
    const response = await app.request("/api/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      service: "policygos-openui-api",
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
