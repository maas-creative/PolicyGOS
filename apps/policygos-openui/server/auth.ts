import { createHash, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { ServerConfig } from "./config.js";

export interface AuthVariables {
  subject: string;
}

interface RateWindow {
  count: number;
  startedAt: number;
}

export function createAuthMiddleware(
  config: ServerConfig
): MiddlewareHandler<{ Variables: AuthVariables }> {
  const windows = new Map<string, RateWindow>();

  return async (context, next) => {
    if (config.deployment === "local") {
      context.set("subject", "local-reviewer");
      await next();
      return;
    }

    const token = readBearerToken(context.req.header("authorization"));
    const subject = token ? findSubject(token, config.accessTokens) : undefined;
    if (!subject) {
      return context.json({ error: "Authentication required" }, 401, {
        "WWW-Authenticate": 'Bearer realm="PolicyGOS"'
      });
    }

    const now = Date.now();
    const current = windows.get(subject);
    const window =
      current && now - current.startedAt < 60_000
        ? current
        : { count: 0, startedAt: now };
    window.count += 1;
    windows.set(subject, window);
    if (window.count > config.rateLimitPerMinute) {
      return context.json(
        { error: "Rate limit exceeded" },
        429,
        { "Retry-After": "60" }
      );
    }

    context.set("subject", subject);
    await next();
  };
}

function readBearerToken(header: string | undefined): string | undefined {
  if (!header?.startsWith("Bearer ")) {
    return undefined;
  }
  const token = header.slice("Bearer ".length).trim();
  return token || undefined;
}

function findSubject(
  candidate: string,
  tokens: ReadonlyMap<string, string>
): string | undefined {
  const candidateHash = createHash("sha256").update(candidate).digest();
  for (const [subject, token] of tokens) {
    const tokenHash = createHash("sha256").update(token).digest();
    if (timingSafeEqual(candidateHash, tokenHash)) {
      return subject;
    }
  }
  return undefined;
}
