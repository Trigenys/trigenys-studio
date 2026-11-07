import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { AuthConfigError, authConfigFromEnv, createAuth, type AuthConfig } from "./auth/auth.ts";
import { sessionMiddleware } from "./auth/middleware.ts";
import { createDb, type Db } from "./db/client.ts";
import type { AppEnv } from "./env.ts";
import { createIntegrations } from "./integrations/registry.ts";
import type { Integrations } from "./integrations/types.ts";
import { ProblemError, ProblemSchema, problem } from "./problem.ts";
import { healthRoutes } from "./routes/health.ts";
import { meRoutes } from "./routes/me.ts";
import { productRoutes } from "./routes/products.ts";
import { roleRoutes } from "./routes/roles.ts";
import { brandKitRoutes } from "./routes/brand-kits.ts";
import { importRoutes } from "./routes/imports.ts";
import { visualRoutes } from "./routes/visuals.ts";
import { socialAccountRoutes } from "./routes/social-accounts.ts";
import { deliveryRoutes } from "./routes/deliveries.ts";
import { alertRoutes } from "./routes/alerts.ts";
import { objectiveRoutes } from "./routes/objectives.ts";
import { reportRoutes } from "./routes/reports.ts";
import { dossierRoutes } from "./routes/dossier.ts";
import { taskRoutes } from "./routes/tasks.ts";
import { MCP_PATH, mcpHandler, mcpOriginGuard, mcpRequireSession } from "./mcp/route.ts";
import { VERSION } from "./version.ts";

export const openApiInfo = {
  openapi: "3.1.0",
  info: {
    title: "Trigenys Studio API",
    version: VERSION,
    description:
      "Cockpit de production et de communication Trigenys. " +
      "L'authentification (passkeys, magic link, bearer) est servie par Better Auth sous /api/auth/* ; " +
      "ses routes sont documentées par Better Auth et ne figurent pas dans ce contrat.",
  },
  tags: [
    { name: "system", description: "État du service" },
    { name: "identity", description: "Utilisateur courant et rôles" },
    { name: "pipeline", description: "Produits, tâches, contenus, transitions et approbations" },
    { name: "dossier", description: "Sources et assistant contextualisé d'une tâche" },
    { name: "imports", description: "Entrées reçues du CMS Insight et du radar Editorial OS" },
    { name: "visuals", description: "Formats, kits de marque et visuels rendus côté serveur" },
  ],
};

// Dependencies a test (or another host) may inject instead of the Worker bindings.
export type AppDeps = {
  db?: Db;
  integrations?: Partial<Integrations>;
  authConfig?: AuthConfig;
};

export function createApp(deps: AppDeps = {}) {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (result.success) return;
      return problem(400, "Validation failed", {
        instance: c.req.path,
        errors: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    },
  });

  app.openAPIRegistry.register("Problem", ProblemSchema);
  app.openAPIRegistry.registerComponent("securitySchemes", "cookieAuth", {
    type: "apiKey",
    in: "cookie",
    name: "better-auth.session_token",
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", { type: "http", scheme: "bearer" });

  app.notFound((c) => problem(404, "Not found", { instance: c.req.path }));
  app.onError((err, c) => {
    if (err instanceof ProblemError) return err.toResponse(c.req.path);
    if (err instanceof AuthConfigError) {
      console.error(err.name, err.message);
      return problem(503, "Authentication not configured", { instance: c.req.path, detail: err.message });
    }
    console.error(err.name, err.message);
    return problem(500, "Internal error", { instance: c.req.path });
  });

  // Public, dependency-free routes first.
  app.route("/", healthRoutes);
  app.doc31("/openapi.json", openApiInfo);

  // Everything below needs the database, the auth instance and the session.
  // Unmatched paths skip the setup so they reach notFound instead of a 503.
  app.use("*", async (c, next) => {
    const routed = c.req.matchedRoutes.some((r) => r.path !== "*" && r.path !== "/*");
    if (!routed) return next();
    c.set("requestId", c.req.header("cf-ray") ?? crypto.randomUUID());
    const integrations = createIntegrations(c.env, deps.integrations);
    c.set("integrations", integrations);
    const db = deps.db ?? (c.env.HYPERDRIVE ? createDb(c.env.HYPERDRIVE.connectionString) : null);
    if (!db) throw new AuthConfigError("HYPERDRIVE binding is required for authenticated routes");
    c.set("db", db);
    const config = deps.authConfig ?? authConfigFromEnv(c.env);
    c.set("auth", createAuth(db, integrations.email, config));
    await next();
  });

  app.use(
    "*",
    cors({
      origin: (origin, c) => {
        try {
          const config = deps.authConfig ?? authConfigFromEnv(c.env);
          return config.trustedOrigins.includes(origin) ? origin : null;
        } catch {
          return null;
        }
      },
      credentials: true,
      allowHeaders: ["content-type", "authorization", "idempotency-key", "mcp-protocol-version", "mcp-session-id"],
      exposeHeaders: ["set-auth-token"],
    }),
  );

  app.on(["GET", "POST"], "/api/auth/*", (c) => c.var.auth.handler(c.req.raw));

  app.use("*", sessionMiddleware);
  app.route("/", meRoutes);
  app.route("/", roleRoutes);
  app.route("/", productRoutes);
  app.route("/", taskRoutes);
  app.route("/", dossierRoutes);
  app.route("/", importRoutes);
  app.route("/", brandKitRoutes);
  app.route("/", visualRoutes);
  app.route("/", socialAccountRoutes);
  app.route("/", deliveryRoutes);
  app.route("/", reportRoutes);
  app.route("/", objectiveRoutes);
  app.route("/", alertRoutes);

  // Agent surface: every tool replays a REST route above with the caller's
  // credentials, so policies and audit trail are identical. Mounted with
  // app.all on purpose: a JSON-RPC endpoint is not part of the OpenAPI contract.
  const trustedOrigins = (c: Context<AppEnv>) => (deps.authConfig ?? authConfigFromEnv(c.env)).trustedOrigins;
  app.all(MCP_PATH, mcpRequireSession, mcpOriginGuard(trustedOrigins), mcpHandler(app));

  return app;
}

export type App = ReturnType<typeof createApp>;
