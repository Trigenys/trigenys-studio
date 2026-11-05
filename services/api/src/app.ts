import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "./env.ts";
import { ProblemSchema, problem } from "./problem.ts";
import { healthRoutes } from "./routes/health.ts";
import { VERSION } from "./version.ts";

export const openApiInfo = {
  openapi: "3.1.0",
  info: {
    title: "Trigenys Studio API",
    version: VERSION,
    description: "Cockpit de production et de communication Trigenys.",
  },
  tags: [{ name: "system", description: "État du service" }],
};

export function createApp() {
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
  app.route("/", healthRoutes);
  app.doc31("/openapi.json", openApiInfo);

  app.notFound((c) => problem(404, "Not found", { instance: c.req.path }));
  app.onError((err, c) => {
    console.error(err.name, err.message);
    return problem(500, "Internal error", { instance: c.req.path });
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
