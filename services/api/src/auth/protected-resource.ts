import { Hono } from "hono";
import type { AppEnv } from "../env.ts";
import { problem } from "../problem.ts";
import type { OidcConfig } from "./oidc.ts";

// OAuth 2.0 Protected Resource Metadata (RFC 9728) for the MCP endpoint. MCP
// clients read it from the WWW-Authenticate challenge, then run the OAuth 2.1
// flow against Trigenys Auth (PKCE, `resource` = the MCP URL).

export const PRM_PATH = "/.well-known/oauth-protected-resource";

/** Path-inserted metadata URL of the resource, e.g. https://host/.well-known/oauth-protected-resource/mcp. */
export function resourceMetadataUrl(config: OidcConfig): string {
  const url = new URL(config.resource);
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  return `${url.origin}${PRM_PATH}${path}`;
}

export function protectedResourceMetadata(config: OidcConfig) {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: [...config.scopes],
    bearer_methods_supported: ["header"],
    resource_name: "Trigenys Studio",
  };
}

/** WWW-Authenticate challenge of a 401 on the protected resource. */
export function bearerChallenge(config: OidcConfig | null, tokenRejected: boolean): string {
  if (!config) return 'Bearer realm="trigenys-studio"';
  const params = [
    `resource_metadata="${resourceMetadataUrl(config)}"`,
    `scope="${config.scopes.join(" ")}"`,
    ...(tokenRejected ? ['error="invalid_token"'] : []),
  ];
  return `Bearer ${params.join(", ")}`;
}

// Public, read-only and cacheable: served before the database setup, for any origin.
export function protectedResourceRoutes(resolve: (c: { env: AppEnv["Bindings"] }) => OidcConfig | null) {
  const routes = new Hono<AppEnv>();
  routes.get(`${PRM_PATH}/*`, (c) => serve(c, resolve(c)));
  routes.get(PRM_PATH, (c) => serve(c, resolve(c)));
  return routes;
}

function serve(c: { req: { path: string } }, config: OidcConfig | null): Response {
  if (!config) return problem(404, "Not found", { instance: c.req.path });
  return new Response(JSON.stringify(protectedResourceMetadata(config)), {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}
