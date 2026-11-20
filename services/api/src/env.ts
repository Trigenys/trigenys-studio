import type { Auth } from "./auth/auth.ts";
import type { OidcVerifier } from "./auth/oidc.ts";
import type { Principal } from "./auth/rbac.ts";
import type { Db } from "./db/client.ts";
import type { Integrations } from "./integrations/types.ts";

export type IntegrationMode = "mock" | "live";

export type Bindings = {
  SERVICE_NAME?: string;
  HYPERDRIVE?: Hyperdrive;
  // Built web app (apps/web/dist), bound in production only (ADR 0016).
  ASSETS?: Fetcher;
  // Better Auth. AUTH_SECRET is a Worker secret (>= 32 chars), never a var.
  AUTH_SECRET?: string;
  // Same role, generated and owned by AppFactory in production.
  TRIGENYS_STUDIO_AUTH_SECRET?: string;
  AUTH_BASE_URL?: string;
  // Comma-separated browser origins allowed to call the API (web app).
  AUTH_TRUSTED_ORIGINS?: string;
  // WebAuthn relying party (defaults to the host of AUTH_BASE_URL).
  PASSKEY_RP_ID?: string;
  PASSKEY_RP_NAME?: string;
  // Trigenys Auth (shared identity provider): the MCP endpoint accepts its JWT
  // access tokens when OIDC_ISSUER is set. OIDC_RESOURCE is the exact resource
  // the tokens are issued for, OIDC_ORGS the organisations (slug or id) allowed
  // in, OIDC_APP the expected `app` claim, OIDC_SCOPES the advertised scopes.
  // Plain vars: the Studio client is public, there is no secret.
  OIDC_ISSUER?: string;
  OIDC_RESOURCE?: string;
  OIDC_ORGS?: string;
  OIDC_APP?: string;
  OIDC_SCOPES?: string;
  // Directory sync from Trigenys Auth (client_credentials, scope `directory`):
  // enabled when OIDC_ISSUER and DIRECTORY_CLIENT_SECRET (Worker secret) are
  // set. DIRECTORY_URL defaults to {OIDC_ISSUER}/api/auth/directory.
  DIRECTORY_CLIENT_ID?: string;
  DIRECTORY_CLIENT_SECRET?: string;
  DIRECTORY_URL?: string;
  INTEGRATION_PUBLISHER_MODE?: IntegrationMode;
  INTEGRATION_CMS_MODE?: IntegrationMode;
  INTEGRATION_RADAR_MODE?: IntegrationMode;
  INTEGRATION_METRICS_MODE?: IntegrationMode;
  INTEGRATION_LLM_MODE?: IntegrationMode;
  INTEGRATION_EMAIL_MODE?: IntegrationMode;
  INTEGRATION_WHATSAPP_MODE?: IntegrationMode;
  // Logos and rendered visuals: private R2 bucket in live mode, memory in mock mode.
  INTEGRATION_MEDIA_MODE?: IntegrationMode;
  VISUALS?: R2Bucket;
  // Live LLM adapter (INTEGRATION_LLM_MODE=live). ANTHROPIC_API_KEY is a
  // Worker secret (wrangler secret put), never a var; LLM_MODEL is optional.
  ANTHROPIC_API_KEY?: string;
  LLM_MODEL?: string;
  // Live CMS adapter (Trigenys Insight): base URL is a var, the publishing
  // token a Worker secret. Studio only reads with it.
  INSIGHT_BASE_URL?: string;
  INSIGHT_PUBLISHING_TOKEN?: string;
  // Live publisher (INTEGRATION_PUBLISHER_MODE=live): Buffer GraphQL API.
  // BUFFER_API_KEY is a Worker secret; the rest are plain vars.
  BUFFER_API_KEY?: string;
  BUFFER_BASE_URL?: string;
  BUFFER_ORGANIZATION_ID?: string;
  // Outbox tuning (minutes before due time a delivery is handed off, max attempts).
  PUBLISH_LEAD_MINUTES?: string;
  PUBLISH_MAX_ATTEMPTS?: string;
  // Live radar adapter (Editorial OS operator API): same split.
  EDITORIAL_OS_BASE_URL?: string;
  EDITORIAL_OS_TOKEN?: string;
  // Live metrics adapter (INTEGRATION_METRICS_MODE=live): generic HTTP JSON
  // contract (ADR 0010). METRICS_TOKEN is a Worker secret. Refresh tuning:
  // minutes before a target is measured again, targets per cron run.
  METRICS_BASE_URL?: string;
  METRICS_TOKEN?: string;
  METRICS_REFRESH_MINUTES?: string;
  METRICS_BATCH?: string;
  // Alerts (ADR 0011): hours before a pending approval, a stalled task or a
  // close due date raise or escalate an alert; WEB_APP_URL is the base of the
  // links in notification e-mails (defaults to the first trusted origin).
  ALERT_APPROVAL_HOURS?: string;
  ALERT_STALL_HOURS?: string;
  ALERT_DUE_SOON_HOURS?: string;
  WEB_APP_URL?: string;
  // Live e-mail (INTEGRATION_EMAIL_MODE=live): Trigenys Notify generic e-mail
  // route (ADR 0013). NOTIFY_EMAIL_INGEST_KEY is a Worker secret scoped to this
  // product; NOTIFY_PROJECT defaults to "trigenys-studio".
  NOTIFY_EMAIL_BASE_URL?: string;
  NOTIFY_EMAIL_INGEST_KEY?: string;
  NOTIFY_PROJECT?: string;
  // Team group chat: WhatsApp through the Notify generic route (ADR 0014).
  // WHATSAPP_NOTIFY_EVENTS lists the events posted to the group (comma
  // separated, today only "task_assigned"); empty means none is queued.
  // INTEGRATION_WHATSAPP_MODE=live needs the NOTIFY_WHATSAPP_INGEST_KEY secret
  // and NOTIFY_WHATSAPP_BASE_URL (defaults to NOTIFY_EMAIL_BASE_URL).
  WHATSAPP_NOTIFY_EVENTS?: string;
  NOTIFY_WHATSAPP_BASE_URL?: string;
  NOTIFY_WHATSAPP_INGEST_KEY?: string;
};

export type Variables = {
  db: Db;
  auth: Auth;
  integrations: Integrations;
  principal: Principal | null;
  // Set when a bearer access token was presented and rejected (MCP 401 hint).
  tokenRejected?: boolean;
  oidc: OidcVerifier | null;
  requestId: string;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
