import { createApp } from "./app.ts";
import type { Bindings } from "./env.ts";
import { runScheduledDispatch, runScheduledMetrics } from "./publishing/scheduled.ts";

const app = createApp();

// HTTP API plus the cron-driven publishing outbox and metrics refresh; one
// failing job never blocks the other.
export default {
  fetch: app.fetch,
  scheduled: (_event, env, ctx) => ctx.waitUntil(Promise.allSettled([runScheduledDispatch(env), runScheduledMetrics(env)])),
} satisfies ExportedHandler<Bindings>;
