import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { pingDb } from "../db/client.ts";
import type { AppEnv } from "../env.ts";
import { integrationModes } from "../integrations/registry.ts";
import { VERSION } from "../version.ts";

const HealthSchema = z
  .object({
    status: z.enum(["ok", "degraded"]),
    service: z.string(),
    version: z.string(),
    time: z.iso.datetime(),
    database: z.enum(["ok", "unavailable", "unconfigured", "unchecked"]),
    integrations: z.record(z.string(), z.enum(["mock", "live"])),
  })
  .openapi("Health");

const route = createRoute({
  method: "get",
  path: "/health",
  tags: ["system"],
  summary: "Liveness and readiness of the API",
  request: {
    query: z.object({
      deep: z
        .enum(["true", "false"])
        .optional()
        .openapi({ description: "When true, also checks the database connection" }),
    }),
  },
  responses: {
    200: { description: "Service state", content: { "application/json": { schema: HealthSchema } } },
  },
});

const ReadinessSchema = z
  .object({
    status: z.enum(["ready", "not_ready"]),
    database: z.enum(["ok", "unavailable", "unconfigured"]),
  })
  .openapi("Readiness");

// Readiness probe used by the AppFactory release gate: ready only when the
// Hyperdrive binding exists and the database answers.
const readyRoute = createRoute({
  method: "get",
  path: "/health/ready",
  tags: ["system"],
  summary: "Readiness of the API (database reachable)",
  responses: {
    200: { description: "Ready", content: { "application/json": { schema: ReadinessSchema } } },
    503: { description: "Not ready", content: { "application/json": { schema: ReadinessSchema } } },
  },
});

export const healthRoutes = new OpenAPIHono<AppEnv>()
  .openapi(readyRoute, async (c) => {
    const hyperdrive = c.env.HYPERDRIVE;
    if (!hyperdrive) return c.json({ status: "not_ready" as const, database: "unconfigured" as const }, 503);
    const ok = await pingDb(hyperdrive.connectionString).catch(() => false);
    return ok
      ? c.json({ status: "ready" as const, database: "ok" as const }, 200)
      : c.json({ status: "not_ready" as const, database: "unavailable" as const }, 503);
  })
  .openapi(route, async (c) => {
  const { deep } = c.req.valid("query");
  let database: z.infer<typeof HealthSchema>["database"] = "unchecked";
  if (deep === "true") {
    const hyperdrive = c.env.HYPERDRIVE;
    if (!hyperdrive) database = "unconfigured";
    else database = (await pingDb(hyperdrive.connectionString).catch(() => false)) ? "ok" : "unavailable";
  }
  return c.json(
    {
      status: database === "unavailable" ? ("degraded" as const) : ("ok" as const),
      service: c.env.SERVICE_NAME ?? "trigenys-studio-api",
      version: VERSION,
      time: new Date().toISOString(),
      database,
      integrations: integrationModes(c.env),
    },
    200,
  );
});
