// Same-origin web app (ADR 0016): the Worker serves the built SPA next to the
// API. The two share paths (/tasks/:id is a page and a resource), so the split
// is on the request kind, not the path: a browser page load gets the app, any
// fetch() keeps reaching the API. Paths only the server can answer (Better
// Auth callbacks, MCP, probes, the contract) never fall to the app.
const SERVER_ONLY = [/^\/api\//, /^\/mcp(\/|$)/, /^\/health(\/|$)/, /^\/openapi\.json$/];

export function isAppNavigation(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const { pathname } = new URL(request.url);
  if (SERVER_ONLY.some((re) => re.test(pathname))) return false;
  const mode = request.headers.get("sec-fetch-mode");
  if (mode) return mode === "navigate";
  // Clients without Fetch Metadata: only an explicit HTML request is a page load.
  return (request.headers.get("accept") ?? "").split(",")[0]?.trim() === "text/html";
}

type Assets = { fetch: (request: Request) => Promise<Response> };

/** Wraps the API handler: page loads go to the static assets when bound. */
export function withWebApp<E extends { ASSETS?: Assets }, C>(
  api: (request: Request, env: E, ctx: C) => Response | Promise<Response>,
) {
  return (request: Request, env: E, ctx: C): Response | Promise<Response> =>
    env.ASSETS && isAppNavigation(request) ? env.ASSETS.fetch(request) : api(request, env, ctx);
}
