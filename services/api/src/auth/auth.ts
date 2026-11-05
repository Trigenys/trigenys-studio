import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { bearer, magicLink } from "better-auth/plugins";
import type { Db } from "../db/client.ts";
import * as schema from "../db/schema.ts";
import type { Bindings } from "../env.ts";
import type { Mailer } from "../integrations/types.ts";

export type AuthConfig = {
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
  rpID: string;
  rpName: string;
};

export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigError";
  }
}

// Reads the auth configuration from Worker bindings and fails early with an
// actionable message instead of letting Better Auth boot in a weak state.
export function authConfigFromEnv(env: Bindings): AuthConfig {
  const secret = env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new AuthConfigError("AUTH_SECRET must be set (Worker secret, at least 32 characters)");
  }
  const baseURL = env.AUTH_BASE_URL;
  if (!baseURL) throw new AuthConfigError("AUTH_BASE_URL must be set (public origin of this API)");
  const trustedOrigins = (env.AUTH_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return {
    secret,
    baseURL,
    trustedOrigins,
    rpID: env.PASSKEY_RP_ID ?? new URL(baseURL).hostname,
    rpName: env.PASSKEY_RP_NAME ?? "Trigenys Studio",
  };
}

// Better Auth is instantiated per request on Workers because bindings are only
// known at request time. The call is cheap: no I/O happens until a route runs.
export function createAuth(db: Db, mailer: Mailer, config: AuthConfig) {
  return betterAuth({
    appName: config.rpName,
    secret: config.secret,
    baseURL: config.baseURL,
    basePath: "/api/auth",
    trustedOrigins: config.trustedOrigins,
    telemetry: { enabled: false },
    database: drizzleAdapter(db, { provider: "pg", schema }),
    // Passwords are deliberately not offered: passkeys and magic links only.
    emailAndPassword: { enabled: false },
    session: {
      // Mobile keeps a bearer token; the web app relies on the httpOnly cookie.
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      // Cookies must survive the web app and the API living on different
      // subdomains of the same site.
      useSecureCookies: config.baseURL.startsWith("https://"),
    },
    plugins: [
      magicLink({
        expiresIn: 60 * 15,
        sendMagicLink: async ({ email, url }) => {
          await mailer.send({
            to: email,
            template: "magic-link",
            subject: "Votre lien de connexion Trigenys Studio",
            text: `Connectez-vous avec ce lien (valable 15 minutes) : ${url}`,
          });
        },
      }),
      passkey({ rpID: config.rpID, rpName: config.rpName, origin: config.trustedOrigins }),
      bearer(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type SessionData = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;
