import { createApp } from "./app.ts";
import type { Bindings } from "./env.ts";
import { withWebApp } from "./web/spa.ts";
import { runScheduledAlerts, runScheduledDirectory, runScheduledDispatch, runScheduledMetrics } from "./publishing/scheduled.ts";

const app = createApp();

// HTTP API plus the cron-driven jobs: the publishing outbox then the alerts
// (which read its outcome), and the metrics refresh beside them; one failing
// job never blocks the others.
const dispatchThenAlerts = async (env: Bindings) => {
  await runScheduledDispatch(env).catch((e: unknown) => console.error("dispatch", e instanceof Error ? e.message : e));
  await runScheduledAlerts(env);
};

export default {
  fetch: withWebApp<Bindings, ExecutionContext>(app.fetch),
  scheduled: (_event, env, ctx) => ctx.waitUntil(Promise.allSettled([dispatchThenAlerts(env), runScheduledMetrics(env), runScheduledDirectory(env)])),
} satisfies ExportedHandler<Bindings>;
