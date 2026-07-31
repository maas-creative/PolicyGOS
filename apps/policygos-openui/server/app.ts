import { OcrBackendClient, normalizedOcrDocumentSchema } from "@policygos/document-ocr-adapter";
import { policyDatasetSchema } from "@policygos/policy-schema";
import {
  extractPolicyDataset,
  ReportMetaError
} from "@policygos/reportmeta";
import { serveStatic } from "@hono/node-server/serve-static";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamText } from "hono/streaming";
import { z } from "zod";
import { createAuditWriter } from "./audit.js";
import {
  createAuthMiddleware,
  type AuthVariables
} from "./auth.js";
import {
  createReportMetaProvider,
  readServerConfig,
  type ServerConfig
} from "./config.js";
import {
  requestOpenUiProgram,
  type OpenUiGenerationRequest
} from "./openui.js";

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const STATIC_ROOT = fileURLToPath(new URL("../dist", import.meta.url));
const INDEX_PATH = fileURLToPath(new URL("../dist/index.html", import.meta.url));
const reportMetaRequestSchema = z.object({
  documents: z
    .array(
      z.object({
        documentId: z.string().min(1),
        fileName: z.string().min(1),
        ocr: normalizedOcrDocumentSchema
      })
    )
    .min(1),
  municipalityHint: z.string().optional(),
  titleHint: z.string().optional()
});
const openUiRequestSchema = z.object({
  dataset: policyDatasetSchema,
  question: z.string().trim().min(1).max(4000),
  audience: z.enum(["resident", "staff", "council", "researcher"]),
  previousResponse: z.string().max(100_000).optional()
});

export function createPolicyApi(
  config: ServerConfig = readServerConfig(),
  dependencies: {
    fetch?: typeof fetch;
    environment?: NodeJS.ProcessEnv;
    writeAudit?: ReturnType<typeof createAuditWriter>;
    staticRoot?: string;
    indexPath?: string;
  } = {}
) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const fetchImpl = dependencies.fetch ?? fetch;
  const environment = dependencies.environment ?? process.env;
  const writeAudit =
    dependencies.writeAudit ?? createAuditWriter(config.auditLogPath);
  const staticRoot = dependencies.staticRoot ?? STATIC_ROOT;
  const indexPath = dependencies.indexPath ?? INDEX_PATH;
  let activeOcrRequests = 0;

  app.use("*", async (context, next) => {
    const requestId = context.req.header("x-request-id") ?? randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("X-Content-Type-Options", "nosniff");
    context.header("X-Frame-Options", "DENY");
    context.header("Referrer-Policy", "no-referrer");
    context.header(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()"
    );
    context.header(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "font-src 'self'",
        "frame-src 'self' blob:",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'"
      ].join("; ")
    );
    await next();
  });

  app.get("/api/health", (context) =>
    context.json({
      status: "healthy",
      service: "policygos-openui-api",
      authRequired: config.deployment === "public"
    })
  );

  app.use("/api/*", async (context, next) => {
    const startedAt = Date.now();
    await next();
    const action = `${context.req.method} ${context.req.path}`;
    const event = {
      timestamp: new Date().toISOString(),
      requestId: context.res.headers.get("X-Request-Id") ?? "unknown",
      subject: context.get("subject") ?? "anonymous",
      action,
      status: context.res.status,
      durationMs: Date.now() - startedAt
    };
    try {
      await writeAudit(event);
    } catch (error) {
      console.error("Failed to write audit event", error);
    }
  });
  app.use("/api/*", createAuthMiddleware(config));
  app.use(
    "/api/ocr/analyze",
    bodyLimit({
      maxSize: MAX_PDF_BYTES + 1024 * 1024,
      onError: (context) =>
        context.json({ error: "Request exceeds the upload limit" }, 413)
    })
  );
  app.use(
    "/api/reportmeta/*",
    bodyLimit({
      maxSize: MAX_JSON_BYTES,
      onError: (context) =>
        context.json({ error: "Request exceeds the JSON limit" }, 413)
    })
  );
  app.use(
    "/api/openui/*",
    bodyLimit({
      maxSize: MAX_JSON_BYTES,
      onError: (context) =>
        context.json({ error: "Request exceeds the JSON limit" }, 413)
    })
  );

  app.get("/api/session", (context) =>
    context.json({ subject: context.get("subject") })
  );

  app.get("/api/runtime", (context) =>
    context.json({
      status: "healthy",
      service: "policygos-openui-api",
      deployment: config.deployment,
      localOnly: config.localOnly,
      reportMeta: {
        provider: config.reportMetaProvider,
        model: config.reportMetaModel,
        host: config.reportMetaProviderHost
      },
      openUi: {
        model: config.openUiModel,
        host: new URL(config.openAiBaseUrl).origin
      },
      ocr: {
        host: new URL(config.ocrBackendUrl).origin
      },
      retention: {
        server: "request-only",
        browser: "until-workspace-is-cleared"
      }
    })
  );

  app.post("/api/ocr/analyze", async (context) => {
    if (activeOcrRequests >= config.maxConcurrentOcr) {
      return context.json(
        { error: "OCR capacity is currently full; retry shortly" },
        503,
        { "Retry-After": "15" }
      );
    }
    const form = await context.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return context.json({ error: "PDF file is required" }, 400);
    }
    if (file.size > MAX_PDF_BYTES) {
      return context.json({ error: "PDF exceeds the 50MB limit" }, 413);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (
      bytes.length < 5 ||
      bytes[0] !== 0x25 ||
      bytes[1] !== 0x50 ||
      bytes[2] !== 0x44 ||
      bytes[3] !== 0x46 ||
      bytes[4] !== 0x2d
    ) {
      return context.json({ error: "Uploaded file is not a PDF" }, 415);
    }
    const client = new OcrBackendClient({
      baseUrl: config.ocrBackendUrl,
      apiToken: config.ocrApiToken,
      fetch: fetchImpl
    });
    activeOcrRequests += 1;
    try {
      const result = await client.analyzeSync(
        {
          fileName: file.name,
          mimeType: "application/pdf",
          bytes
        },
        context.req.raw.signal
      );
      return context.json(result);
    } finally {
      activeOcrRequests -= 1;
    }
  });

  app.post("/api/reportmeta/extract", async (context) => {
    const request = reportMetaRequestSchema.parse(await context.req.json());
    const provider = createReportMetaProvider(environment);
    const result = await extractPolicyDataset(
      {
        documents: request.documents,
        ...(request.municipalityHint
          ? { municipalityHint: request.municipalityHint }
          : {}),
        ...(request.titleHint ? { titleHint: request.titleHint } : {}),
        signal: context.req.raw.signal
      },
      provider
    );
    return context.json(result);
  });

  app.post("/api/openui/generate", async (context) => {
    const request = openUiRequestSchema.parse(
      await context.req.json()
    ) as OpenUiGenerationRequest;
    const publishableValues = request.dataset.indicators.flatMap(
      ({ values }) =>
        values.filter(({ reviewStatus, evidenceIds }) =>
          ["confirmed", "corrected"].includes(reviewStatus) &&
          evidenceIds.length > 0
        )
    );
    if (publishableValues.length === 0) {
      return context.json(
        { error: "No confirmed or corrected values are available" },
        409
      );
    }
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 120_000);
    let program: string;
    try {
      program = await requestOpenUiProgram(
        request,
        config,
        controller.signal,
        fetchImpl
      );
    } catch (error) {
      if (timedOut) {
        throw new Error("OpenUI generation timed out after 120 seconds");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    return streamText(context, async (stream) => {
      for (const line of program.match(/[^\n]*\n|[^\n]+$/g) ?? [program]) {
        await stream.write(line);
      }
    });
  });

  app.onError((error, context) => {
    const status =
      error instanceof z.ZodError
        ? 400
        : error instanceof ReportMetaError
          ? 422
          : 502;
    const exposedMessage =
      status < 500 || config.deployment === "local"
        ? error.message
        : "Upstream processing failed";
    console.error(
      JSON.stringify({
        requestId: context.res.headers.get("X-Request-Id"),
        path: context.req.path,
        error: error.message
      })
    );
    return context.json(
      {
        error: exposedMessage,
        ...(error instanceof ReportMetaError ? { code: error.code } : {})
      },
      status
    );
  });

  app.use("/*", serveStatic({ root: staticRoot }));
  app.get("*", async (context) => {
    if (context.req.path.startsWith("/api/")) {
      return context.json({ error: "Not found" }, 404);
    }
    return context.html(await readFile(indexPath, "utf8"));
  });

  return app;
}
