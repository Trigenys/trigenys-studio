import type { Auth } from "./auth/auth.ts";
import type { Principal } from "./auth/rbac.ts";
import type { Db } from "./db/client.ts";
import type { Integrations } from "./integrations/types.ts";

export type IntegrationMode = "mock" | "live";

export type Bindings = {
  SERVICE_NAME?: string;
  HYPERDRIVE?: Hyperdrive;
  // Better Auth. AUTH_SECRET is a Worker secret (>= 32 chars), never a var.
  AUTH_SECRET?: string;
  AUTH_BASE_URL?: string;
  // Comma-separated browser origins allowed to call the API (web app).
  AUTH_TRUSTED_ORIGINS?: string;
  // WebAuthn relying party (defaults to the host of AUTH_BASE_URL).
  PASSKEY_RP_ID?: string;
  PASSKEY_RP_NAME?: string;
  INTEGRATION_PUBLISHER_MODE?: IntegrationMode;
  INTEGRATION_CMS_MODE?: IntegrationMode;
  INTEGRATION_RADAR_MODE?: IntegrationMode;
  INTEGRATION_METRICS_MODE?: IntegrationMode;
  INTEGRATION_LLM_MODE?: IntegrationMode;
  INTEGRATION_EMAIL_MODE?: IntegrationMode;
  // Live LLM adapter (INTEGRATION_LLM_MODE=live). ANTHROPIC_API_KEY is a
  // Worker secret (wrangler secret put), never a var; LLM_MODEL is optional.
  ANTHROPIC_API_KEY?: string;
  LLM_MODEL?: string;
  // Live CMS adapter (Trigenys Insight): base URL is a var, the publishing
  // token a Worker secret. Studio only reads with it.
  INSIGHT_BASE_URL?: string;
  INSIGHT_PUBLISHING_TOKEN?: string;
  // Live radar adapter (Editorial OS operator API): same split.
  EDITORIAL_OS_BASE_URL?: string;
  EDITORIAL_OS_TOKEN?: string;
};

export type Variables = {
  db: Db;
  auth: Auth;
  integrations: Integrations;
  principal: Principal | null;
  requestId: string;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
