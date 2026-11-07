import type { Context, Env, ExecutionContext as HonoExecutionContext } from "hono";
import type { AppEnv } from "../env.ts";
import type { RouteCall } from "./tools.ts";

export type RouteResult = { status: number; body: unknown };
export type Dispatcher = (call: RouteCall) => Promise<RouteResult>;

export type Fetcher = {
  fetch: (request: Request, env?: Env["Bindings"], ctx?: HonoExecutionContext) => Promise<Response> | Response;
};

// Replays a route in-process with the caller's credentials. The replayed
// request goes through the same middleware chain as an HTTP call (CORS,
// session, RBAC, audit, idempotency), so a tool can never do more than the
// REST route it maps to.
export function dispatcherFor(app: Fetcher, c: Context<AppEnv>): Dispatcher {
  return async (call) => {
    const url = new URL(call.path, c.req.url);
    for (const [key, value] of Object.entries(call.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers = new Headers({ accept: "application/json" });
    for (const name of ["authorization", "cookie"]) {
      const value = c.req.header(name);
      if (value) headers.set(name, value);
    }
    if (call.idempotencyKey) headers.set("idempotency-key", call.idempotencyKey);
    let body: string | undefined;
    if (call.method !== "GET") {
      headers.set("content-type", "application/json");
      body = JSON.stringify(call.body ?? {});
    }
    let ctx: HonoExecutionContext | undefined;
    try {
      ctx = c.executionCtx;
    } catch {
      ctx = undefined;
    }
    const res = await app.fetch(new Request(url, { method: call.method, headers, body }), c.env, ctx);
    const text = await res.text();
    let parsed: unknown = text;
    if (text && /json/.test(res.headers.get("content-type") ?? "")) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: res.status, body: parsed };
  };
}
