import { StreamableHTTPTransport } from "@hono/mcp";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env.ts";
import { problem } from "../problem.ts";
import { dispatcherFor, type Fetcher } from "./dispatch.ts";
import { buildMcpServer } from "./server.ts";

export const MCP_PATH = "/mcp";

// Agents hold a bearer session token, but a cookie session also works, which
// is why browser origins are checked: an origin outside the trusted list is
// refused before any tool runs.
export function mcpOriginGuard(trustedOrigins: (c: Context<AppEnv>) => readonly string[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const origin = c.req.header("origin");
    if (origin && !trustedOrigins(c).includes(origin)) {
      return problem(403, "Origin not allowed", { instance: c.req.path });
    }
    await next();
  });
}

export const mcpRequireSession = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.var.principal) {
    const res = problem(401, "Authentication required", { instance: c.req.path });
    res.headers.set("www-authenticate", 'Bearer realm="trigenys-studio"');
    return res;
  }
  await next();
});

// Stateless Streamable HTTP: every POST carries a full JSON-RPC exchange, no
// session id, JSON responses (no SSE stream to keep alive on a Worker).
export function mcpHandler(app: Fetcher) {
  return async (c: Context<AppEnv>) => {
    if (c.req.method !== "POST") {
      const res = problem(405, "Method not allowed", {
        instance: c.req.path,
        detail: "The MCP endpoint accepts POST only",
      });
      res.headers.set("allow", "POST");
      return res;
    }
    const transport = new StreamableHTTPTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const server = buildMcpServer(dispatcherFor(app, c));
    await server.connect(transport);
    try {
      return (await transport.handleRequest(c)) ?? problem(500, "MCP transport produced no response");
    } finally {
      await server.close().catch(() => undefined);
    }
  };
}
