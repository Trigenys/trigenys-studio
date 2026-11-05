import { createApp } from "./app.ts";
import type { Bindings } from "./env.ts";
import { runScheduledDispatch } from "./publishing/scheduled.ts";

const app = createApp();

// HTTP API plus the cron-driven publishing outbox.
export default {
  fetch: app.fetch,
  scheduled: (_event, env, ctx) => ctx.waitUntil(runScheduledDispatch(env)),
} satisfies ExportedHandler<Bindings>;
