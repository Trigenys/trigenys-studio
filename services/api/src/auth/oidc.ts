import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import type { Bindings } from "../env.ts";
import { ProblemError } from "../problem.ts";
import { AuthConfigError } from "./auth.ts";

// The MCP endpoint (and the REST routes it replays) is an OAuth 2.1 protected
// resource of Trigenys Auth, the shared identity provider: it accepts the JWT
// access tokens (RFC 9068) that Trigenys Auth issues for this resource, next
// to the Better Auth sessions. Contract: Trigenys/trigenys-auth
// docs/contracts/oidc.md (1.x). Nothing here runs when OIDC_ISSUER is empty.

export type OidcConfig = {
  issuer: string;
  // Exact resource identifier the tokens are issued for (no trailing slash).
  resource: string;
  // Expected `app` claim: the logical client id declared in Trigenys Auth.
  app: string;
  // Organisations (slug or id) whose members may use the Studio. Required:
  // client default roles apply to members of any organisation.
  orgs: readonly string[];
  // Scopes advertised to clients in the protected resource metadata.
  scopes: readonly string[];
};

const list = (value: string | undefined) =>
  (value ?? "")
    .split(/[\s,]+/)
    .map((v) => v.trim())
    .filter(Boolean);

export function oidcConfigFromEnv(env: Bindings): OidcConfig | null {
  const issuer = env.OIDC_ISSUER?.trim().replace(/\/+$/, "");
  if (!issuer) return null;
  const resource = env.OIDC_RESOURCE?.trim();
  if (!resource) throw new AuthConfigError("OIDC_RESOURCE is required when OIDC_ISSUER is set");
  const orgs = list(env.OIDC_ORGS);
  if (orgs.length === 0) throw new AuthConfigError("OIDC_ORGS is required when OIDC_ISSUER is set");
  const scopes = list(env.OIDC_SCOPES);
  return {
    issuer,
    resource,
    app: env.OIDC_APP?.trim() || "trigenys-studio",
    orgs,
    scopes: scopes.length > 0 ? scopes : ["openid", "profile", "email", "org", "roles", "offline_access"],
  };
}

export type OidcClaims = {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  roles: string[];
};

// A rejected token: the caller answers 401 with error="invalid_token".
export class OidcTokenError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "OidcTokenError";
  }
}

type Discovery = { issuer: string; jwks_uri: string; userinfo_endpoint?: string; algorithms: string[] };

// Asymmetric algorithms only: `none` and HMAC are refused whatever discovery says.
const ASYMMETRIC = /^(EdDSA|Ed25519|ES(256|384|512)|RS(256|384|512)|PS(256|384|512))$/;

/** True when the bearer looks like a JWT access token (three segments, typ at+jwt). */
export function isJwtAccessToken(token: string): boolean {
  if (token.split(".").length !== 3) return false;
  try {
    const typ = decodeProtectedHeader(token).typ?.toLowerCase();
    return typ === "at+jwt" || typ === "application/at+jwt";
  } catch {
    return false;
  }
}

export type OidcVerifier = {
  config: OidcConfig;
  verify(token: string): Promise<OidcClaims>;
  // Profile lookup for the first connection, when the access token carries no e-mail.
  userinfo(token: string): Promise<{ email: string | null; emailVerified: boolean; name: string | null }>;
};

export function createOidcVerifier(config: OidcConfig): OidcVerifier {
  let discovery: Promise<Discovery> | null = null;
  let jwks: JWTVerifyGetKey | null = null;

  const discover = () => {
    discovery ??= (async () => {
      const res = await fetch(`${config.issuer}/.well-known/openid-configuration`, {
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(`discovery answered ${res.status}`);
      const doc = (await res.json()) as Record<string, unknown>;
      if (doc.issuer !== config.issuer) throw new Error("discovery issuer does not match OIDC_ISSUER");
      if (typeof doc.jwks_uri !== "string") throw new Error("discovery has no jwks_uri");
      const announced = Array.isArray(doc.id_token_signing_alg_values_supported)
        ? (doc.id_token_signing_alg_values_supported as unknown[]).filter((a): a is string => typeof a === "string")
        : ["EdDSA"];
      const algorithms = announced.filter((a) => ASYMMETRIC.test(a));
      if (algorithms.length === 0) throw new Error("discovery announces no asymmetric signing algorithm");
      return {
        issuer: doc.issuer,
        jwks_uri: doc.jwks_uri,
        userinfo_endpoint: typeof doc.userinfo_endpoint === "string" ? doc.userinfo_endpoint : undefined,
        algorithms,
      };
    })().catch((e: unknown) => {
      discovery = null; // retried on the next request
      throw new ProblemError(503, "Identity provider unavailable", {
        detail: e instanceof Error ? e.message : "discovery failed",
      });
    });
    return discovery;
  };

  return {
    config,
    async verify(token) {
      const meta = await discover();
      // Cached per isolate; jose reloads it on an unknown kid (30 s cooldown).
      jwks ??= createRemoteJWKSet(new URL(meta.jwks_uri), { cooldownDuration: 30_000 });
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, jwks, {
          issuer: config.issuer,
          audience: config.resource,
          typ: "at+jwt",
          algorithms: meta.algorithms,
          clockTolerance: 60,
          requiredClaims: ["sub", "exp"],
        }));
      } catch (e) {
        throw new OidcTokenError(e instanceof Error ? e.message : "invalid token");
      }
      if (payload.app !== config.app) throw new OidcTokenError("token was not issued for this application");
      const org = payload.org as { id?: unknown; slug?: unknown } | undefined;
      const allowed = [org?.id, org?.slug].some((v) => typeof v === "string" && config.orgs.includes(v));
      if (!allowed) throw new OidcTokenError("organisation not allowed");
      const roles = Array.isArray(payload.roles) ? payload.roles.filter((r): r is string => typeof r === "string") : [];
      return {
        sub: payload.sub!,
        email: typeof payload.email === "string" ? payload.email : null,
        emailVerified: payload.email_verified === true,
        name: typeof payload.name === "string" ? payload.name : null,
        roles,
      };
    },
    async userinfo(token) {
      const meta = await discover();
      if (!meta.userinfo_endpoint) return { email: null, emailVerified: false, name: null };
      const res = await fetch(meta.userinfo_endpoint, { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) return { email: null, emailVerified: false, name: null };
      const info = (await res.json()) as Record<string, unknown>;
      return {
        email: typeof info.email === "string" ? info.email : null,
        emailVerified: info.email_verified === true,
        name: typeof info.name === "string" ? info.name : null,
      };
    },
  };
}

// One verifier per configuration and isolate, so discovery and JWKS stay cached.
const verifiers = new Map<string, OidcVerifier>();

export function oidcVerifierFor(config: OidcConfig | null): OidcVerifier | null {
  if (!config) return null;
  const key = JSON.stringify(config);
  let verifier = verifiers.get(key);
  if (!verifier) {
    verifier = createOidcVerifier(config);
    verifiers.set(key, verifier);
  }
  return verifier;
}
