import { describe, expect, it } from "vitest";
import { createPolicyApi } from "./app.js";
import { assertProviderAllowed, readServerConfig } from "./config.js";

describe("PolicyGOS API", () => {
  it("reports local-only runtime state", async () => {
    const app = createPolicyApi(readServerConfig({}));
    const response = await app.request("/api/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      service: "policygos-openui-api",
      localOnly: true
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
});
