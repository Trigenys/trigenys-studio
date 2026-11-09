import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Identity: tables owned by Better Auth (core schema + passkey plugin).
// Column names follow the Better Auth Drizzle generator so the adapter maps
// them without configuration. Changes here go through the adapter contract.
// ---------------------------------------------------------------------------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

export const passkey = pgTable(
  "passkey",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull(),
    counter: integer("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: boolean("backed_up").notNull(),
    transports: text("transports"),
    createdAt: timestamp("created_at"),
    aaguid: text("aaguid"),
  },
  (t) => [index("passkey_user_id_idx").on(t.userId), index("passkey_credential_id_idx").on(t.credentialID)],
);

// ---------------------------------------------------------------------------
// Authorization: explicit role assignments, optionally scoped to a product.
// A null product means the role applies to every product.
// ---------------------------------------------------------------------------

export const ROLES = ["admin", "operator", "reviewer"] as const;
export type Role = (typeof ROLES)[number];

export const roleAssignment = pgTable(
  "role_assignment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ROLES }).notNull(),
    productId: text("product_id"),
    grantedBy: text("granted_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("role_assignment_user_id_idx").on(t.userId),
    // One row per (user, role, product); the empty string stands in for "all products".
    uniqueIndex("role_assignment_unique_idx").on(t.userId, t.role, sql`coalesce(${t.productId}, '')`),
  ],
);

// ---------------------------------------------------------------------------
// Audit: append-only journal. UPDATE and DELETE are rejected by a trigger
// installed by the migration (0001_audit_append_only.sql), whatever the role.
// ---------------------------------------------------------------------------

export const AUDIT_OUTCOMES = ["allowed", "denied"] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export const auditEvent = pgTable(
  "audit_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    outcome: text("outcome", { enum: AUDIT_OUTCOMES }).notNull(),
    details: jsonb("details").$type<Record<string, unknown>>(),
    requestId: text("request_id"),
  },
  (t) => [index("audit_event_at_idx").on(t.at), index("audit_event_actor_id_idx").on(t.actorId)],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  passkeys: many(passkey),
  roles: many(roleAssignment),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export const passkeyRelations = relations(passkey, ({ one }) => ({
  user: one(user, { fields: [passkey.userId], references: [user.id] }),
}));

export const roleAssignmentRelations = relations(roleAssignment, ({ one }) => ({
  user: one(user, { fields: [roleAssignment.userId], references: [user.id] }),
}));

// ---------------------------------------------------------------------------
// Products and the editorial pipeline. States are identifiers; the pipeline
// definition (src/pipeline/definition.ts) says which transitions exist, who may
// take them and under which guard. Labels belong to the clients.
// ---------------------------------------------------------------------------

export const product = pgTable("product", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // External SEO Monitor page for the product (link only; metrics come through the port).
  seoMonitorUrl: text("seo_monitor_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const TASK_STATES = [
  "qualifying",
  "preparing",
  "reviewing",
  "visuals",
  "awaiting_approval",
  "approved",
  "scheduled",
  "published",
  "measured",
  "needs_fix",
  "rejected",
  "failed",
] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const task = pgTable(
  "task",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: text("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "restrict" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    brief: text("brief").notNull().default(""),
    state: text("state", { enum: TASK_STATES }).notNull().default("qualifying"),
    priority: integer("priority").notNull().default(0),
    dueAt: timestamp("due_at", { withTimezone: true }),
    assigneeId: text("assignee_id").references(() => user.id, { onDelete: "set null" }),
    // Optimistic concurrency: every mutation bumps it and clients send it back.
    version: integer("version").notNull().default(1),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("task_product_state_idx").on(t.productId, t.state),
    index("task_assignee_idx").on(t.assigneeId),
    index("task_due_at_idx").on(t.dueAt),
  ],
);

export const contentVersion = pgTable(
  "content_version",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    n: integer("n").notNull(),
    channel: text("channel").notNull(),
    body: text("body").notNull(),
    contentHash: text("content_hash").notNull(),
    aiAssisted: boolean("ai_assisted").notNull().default(false),
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("content_version_task_n_idx").on(t.taskId, t.n)],
);

export const comment = pgTable(
  "comment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("comment_task_idx").on(t.taskId)],
);

export const APPROVAL_DECISIONS = ["approved", "rejected"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

// An approval is bound to what was approved: the content version and the
// asset set, by hash. Publication re-checks both against the current state.
export const approval = pgTable(
  "approval",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    contentVersionId: uuid("content_version_id")
      .notNull()
      .references(() => contentVersion.id, { onDelete: "restrict" }),
    contentHash: text("content_hash").notNull(),
    assetSetHash: text("asset_set_hash").notNull(),
    approverId: text("approver_id").references(() => user.id, { onDelete: "set null" }),
    decision: text("decision", { enum: APPROVAL_DECISIONS }).notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("approval_task_idx").on(t.taskId)],
);

export const taskTransition = pgTable(
  "task_transition",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    fromState: text("from_state", { enum: TASK_STATES }).notNull(),
    toState: text("to_state", { enum: TASK_STATES }).notNull(),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("task_transition_task_idx").on(t.taskId), index("task_transition_to_state_idx").on(t.toState, t.createdAt)],
);

// Replay store for Idempotency-Key: one row per (key, actor); the fingerprint
// detects a key reused for a different request.
export const idempotencyKey = pgTable(
  "idempotency_key",
  {
    key: text("key").notNull(),
    actorId: text("actor_id").notNull(),
    scope: text("scope").notNull(),
    fingerprint: text("fingerprint").notNull(),
    status: integer("status").notNull(),
    body: jsonb("body"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.actorId] })],
);

// ---------------------------------------------------------------------------
// Editorial dossier: sources attached to a task and audited assistant runs.
// ---------------------------------------------------------------------------

export const SOURCE_ORIGINS = ["manual", "radar", "cms"] as const;
export type SourceOrigin = (typeof SOURCE_ORIGINS)[number];

export const taskSource = pgTable(
  "task_source",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    origin: text("origin").$type<SourceOrigin>().notNull().default("manual"),
    title: text("title").notNull(),
    url: text("url"),
    note: text("note").notNull().default(""),
    addedBy: text("added_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("task_source_task_idx").on(t.taskId)],
);

export const AI_ACTIONS = ["propose", "fix", "summarize", "adapt"] as const;
export type AiAction = (typeof AI_ACTIONS)[number];
export const AI_INTERACTION_STATUSES = ["proposed", "accepted", "dismissed"] as const;
export type AiInteractionStatus = (typeof AI_INTERACTION_STATUSES)[number];

// Every assistant run is kept with what it saw (context refs, input hash),
// what it produced and what became of it. An output only becomes content
// through an explicit accept, which creates a new content_version.
export const aiInteraction = pgTable(
  "ai_interaction",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    action: text("action").$type<AiAction>().notNull(),
    channel: text("channel").notNull(),
    instruction: text("instruction").notNull().default(""),
    model: text("model").notNull(),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    contextRefs: jsonb("context_refs").$type<string[]>().notNull().default([]),
    inputHash: text("input_hash").notNull(),
    output: text("output").notNull(),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    status: text("status").$type<AiInteractionStatus>().notNull().default("proposed"),
    acceptedVersionId: uuid("accepted_version_id").references(() => contentVersion.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("ai_interaction_task_idx").on(t.taskId)],
);

export const IMPORT_ORIGINS = ["cms", "radar"] as const;
export type ImportOrigin = (typeof IMPORT_ORIGINS)[number];
export const IMPORT_STATUSES = ["new", "linked", "ignored"] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

// What the CMS and the radar hand over, one row per (origin, external ref).
// A sync upserts the description and keeps the decision (status, task):
// replaying it never duplicates nor resets what an operator did.
export const importItem = pgTable(
  "import_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    origin: text("origin").$type<ImportOrigin>().notNull(),
    externalRef: text("external_ref").notNull(),
    title: text("title").notNull(),
    url: text("url"),
    summary: text("summary").notNull().default(""),
    sources: jsonb("sources").$type<string[]>().notNull().default([]),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    status: text("status").$type<ImportStatus>().notNull().default("new"),
    taskId: uuid("task_id").references(() => task.id, { onDelete: "set null" }),
    decidedBy: text("decided_by").references(() => user.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("import_item_origin_ref_idx").on(t.origin, t.externalRef), index("import_item_status_idx").on(t.status, t.observedAt)],
);

// ---------------------------------------------------------------------------
// Visuals: formats are data, brand kits are versioned and immutable once
// approved, assets are content-addressed renders bound to a kit by hash.
// ---------------------------------------------------------------------------

export type VisualLayout = {
  padding: number;
  titleSize: number;
  subtitleSize: number;
  logoHeight: number;
  logoPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  titleMaxLines: number;
};

export const visualFormat = pgTable("visual_format", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  channel: text("channel"),
  layout: jsonb("layout").$type<VisualLayout>().notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const BRAND_KIT_STATUSES = ["draft", "approved", "retired"] as const;
export type BrandKitStatus = (typeof BRAND_KIT_STATUSES)[number];
export type BrandPalette = { primary: string; secondary: string; background: string; text: string; accent?: string };

export const brandKit = pgTable(
  "brand_kit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: text("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "restrict" }),
    n: integer("n").notNull(),
    name: text("name").notNull(),
    status: text("status").$type<BrandKitStatus>().notNull().default("draft"),
    palette: jsonb("palette").$type<BrandPalette>().notNull(),
    fontFamily: text("font_family").notNull(),
    defaultTitle: text("default_title"),
    mentions: text("mentions").notNull().default(""),
    logoKey: text("logo_key").notNull(),
    logoMime: text("logo_mime").notNull(),
    logoHash: text("logo_hash").notNull(),
    logoBytes: integer("logo_bytes").notNull(),
    // sha256 of the canonical kit description (palette, font, texts, logo hash).
    kitHash: text("kit_hash").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    approvedBy: text("approved_by").references(() => user.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("brand_kit_product_n_idx").on(t.productId, t.n),
    uniqueIndex("brand_kit_one_approved_idx").on(t.productId).where(sql`status = 'approved'`),
  ],
);

export const VISUAL_STATUSES = ["active", "discarded"] as const;
export type VisualStatus = (typeof VISUAL_STATUSES)[number];

export const visualAsset = pgTable(
  "visual_asset",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    formatId: text("format_id")
      .notNull()
      .references(() => visualFormat.id, { onDelete: "restrict" }),
    brandKitId: uuid("brand_kit_id")
      .notNull()
      .references(() => brandKit.id, { onDelete: "restrict" }),
    brandKitHash: text("brand_kit_hash").notNull(),
    contentVersionId: uuid("content_version_id").references(() => contentVersion.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    subtitle: text("subtitle").notNull().default(""),
    brief: text("brief").notNull().default(""),
    variant: integer("variant").notNull(),
    renderer: text("renderer").notNull(),
    mime: text("mime").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    contentHash: text("content_hash").notNull(),
    storageKey: text("storage_key").notNull(),
    byteSize: integer("byte_size").notNull(),
    status: text("status").$type<VisualStatus>().notNull().default("active"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    discardedBy: text("discarded_by").references(() => user.id, { onDelete: "set null" }),
    discardedAt: timestamp("discarded_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("visual_asset_task_format_variant_idx").on(t.taskId, t.formatId, t.variant),
    uniqueIndex("visual_asset_active_hash_idx").on(t.taskId, t.contentHash).where(sql`status = 'active'`),
    index("visual_asset_task_status_idx").on(t.taskId, t.status),
  ],
);

// ---------------------------------------------------------------------------
// Publishing: explicit social account mapping per product and channel, and an
// outbox of deliveries handed to the publisher. Nothing is ever cross-posted
// by inference: a delivery targets exactly one mapped account, and the account
// channel must equal the channel of the approved content version.
// ---------------------------------------------------------------------------

export const SOCIAL_PROVIDERS = ["buffer", "mock"] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export const socialAccount = pgTable(
  "social_account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: text("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "restrict" }),
    channel: text("channel").notNull(),
    provider: text("provider").$type<SocialProvider>().notNull(),
    // The provider's own identifier of the channel (Buffer channel id).
    externalRef: text("external_ref").notNull(),
    handle: text("handle").notNull(),
    displayName: text("display_name").notNull(),
    active: boolean("active").notNull().default(true),
    version: integer("version").notNull().default(1),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("social_account_provider_ref_idx").on(t.productId, t.provider, t.externalRef),
    index("social_account_product_channel_idx").on(t.productId, t.channel),
  ],
);

export const DELIVERY_STATUSES = ["draft", "scheduled", "sending", "handed_off", "sent", "failed", "cancelled"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const delivery = pgTable(
  "delivery",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    socialAccountId: uuid("social_account_id")
      .notNull()
      .references(() => socialAccount.id, { onDelete: "restrict" }),
    contentVersionId: uuid("content_version_id")
      .notNull()
      .references(() => contentVersion.id, { onDelete: "restrict" }),
    approvalId: uuid("approval_id")
      .notNull()
      .references(() => approval.id, { onDelete: "restrict" }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    status: text("status").$type<DeliveryStatus>().notNull().default("draft"),
    // sha256(task:account:version:approval): stable across retries, different
    // as soon as the approved content changes.
    idempotencyKey: text("idempotency_key").notNull(),
    externalId: text("external_id"),
    permalink: text("permalink"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lastError: text("last_error"),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    // Lease held while a provider call is in flight; an expired lease is
    // reconciled, never re-sent blindly.
    claimedUntil: timestamp("claimed_until", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("delivery_active_target_idx").on(t.taskId, t.socialAccountId).where(sql`status <> 'cancelled'`),
    uniqueIndex("delivery_idempotency_key_idx").on(t.idempotencyKey),
    uniqueIndex("delivery_external_id_idx").on(t.externalId).where(sql`external_id IS NOT NULL`),
    index("delivery_status_scheduled_idx").on(t.status, t.scheduledAt),
    index("delivery_task_idx").on(t.taskId),
    index("delivery_sent_at_idx").on(t.sentAt),
  ],
);

export const ATTEMPT_TRIGGERS = ["cron", "manual", "retry"] as const;
export type AttemptTrigger = (typeof ATTEMPT_TRIGGERS)[number];
export const ATTEMPT_OUTCOMES = ["handed_off", "sent", "retryable_error", "fatal_error", "reconciled", "unknown"] as const;
export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];

// Append-only send history: one row per provider call (or per refusal
// decided before the call), kept whatever the delivery becomes.
export const deliveryAttempt = pgTable(
  "delivery_attempt",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => delivery.id, { onDelete: "cascade" }),
    n: integer("n").notNull(),
    trigger: text("trigger").$type<AttemptTrigger>().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    outcome: text("outcome").$type<AttemptOutcome>(),
    externalId: text("external_id"),
    error: text("error"),
    retryAfterS: integer("retry_after_s"),
  },
  (t) => [uniqueIndex("delivery_attempt_n_idx").on(t.deliveryId, t.n)],
);

// ---------------------------------------------------------------------------
// Reporting: contractual objectives per product (monthly, against operational
// counts) and verified metric snapshots (append-only, one per provider,
// target and measurement time). Mock providers never write here.
// ---------------------------------------------------------------------------

export const OBJECTIVE_METRICS = ["tasks_completed", "articles_published", "deliveries_sent"] as const;
export type ObjectiveMetric = (typeof OBJECTIVE_METRICS)[number];

export const contractObjective = pgTable(
  "contract_objective",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: text("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "restrict" }),
    metric: text("metric").$type<ObjectiveMetric>().notNull(),
    taskType: text("task_type"),
    channel: text("channel"),
    period: text("period").notNull().default("month"),
    target: integer("target").notNull(),
    active: boolean("active").notNull().default(true),
    version: integer("version").notNull().default(1),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check("contract_objective_target_check", sql`${t.target} > 0`),
    uniqueIndex("contract_objective_scope_idx")
      .on(t.productId, t.metric, sql`coalesce(${t.taskType}, '')`, sql`coalesce(${t.channel}, '')`, t.period)
      .where(sql`active`),
  ],
);

export const METRIC_TARGET_KINDS = ["deliverable", "url"] as const;
export type MetricTargetKind = (typeof METRIC_TARGET_KINDS)[number];

export const metricSnapshot = pgTable(
  "metric_snapshot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: text("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "restrict" }),
    targetKind: text("target_kind").$type<MetricTargetKind>().notNull(),
    targetRef: text("target_ref").notNull(),
    deliveryId: uuid("delivery_id").references(() => delivery.id, { onDelete: "set null" }),
    taskId: uuid("task_id").references(() => task.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
    metrics: jsonb("metrics").$type<Record<string, number>>().notNull().default({}),
  },
  (t) => [
    uniqueIndex("metric_snapshot_dedupe_idx").on(t.provider, t.targetKind, t.targetRef, t.measuredAt),
    index("metric_snapshot_target_idx").on(t.targetKind, t.targetRef, t.fetchedAt),
    index("metric_snapshot_product_idx").on(t.productId, t.measuredAt),
  ],
);

// ---------------------------------------------------------------------------
// Alerts (ADR 0011): derived state written by one reconciler. An alert names
// one thing that needs a human decision and points at the task to fix; the
// partial unique index keeps one unresolved alert per dedup key. Alerts are
// acknowledged by people and resolved by the reconciler only.
// ---------------------------------------------------------------------------

export const ALERT_KINDS = ["task_blocked", "content_fix", "approval_required", "publication_failed"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];
export const ALERT_PRIORITIES = ["p1", "p2", "p3"] as const;
export type AlertPriority = (typeof ALERT_PRIORITIES)[number];
export const ALERT_STATES = ["open", "acknowledged", "resolved"] as const;
export type AlertState = (typeof ALERT_STATES)[number];

export const alert = pgTable(
  "alert",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: ALERT_KINDS }).notNull(),
    priority: text("priority", { enum: ALERT_PRIORITIES }).notNull(),
    state: text("state", { enum: ALERT_STATES }).notNull().default("open"),
    dedupKey: text("dedup_key").notNull(),
    productId: text("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "restrict" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    deliveryId: uuid("delivery_id").references(() => delivery.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    detail: text("detail").notNull().default(""),
    facts: jsonb("facts").$type<Record<string, unknown>>().notNull().default({}),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    acknowledgedBy: text("acknowledged_by").references(() => user.id, { onDelete: "set null" }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolution: text("resolution"),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    uniqueIndex("alert_active_dedup_idx").on(t.dedupKey).where(sql`state <> 'resolved'`),
    index("alert_product_state_priority_idx").on(t.productId, t.state, t.priority),
    index("alert_task_idx").on(t.taskId),
  ],
);

export const NOTIFICATION_EMAIL_MODES = ["off", "immediate"] as const;
export type NotificationEmailMode = (typeof NOTIFICATION_EMAIL_MODES)[number];

// Per-user, per-kind e-mail preference. Absent row = the default of the kind.
export const notificationPreference = pgTable(
  "notification_preference",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ALERT_KINDS }).notNull(),
    email: text("email", { enum: NOTIFICATION_EMAIL_MODES }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("notification_preference_user_kind_idx").on(t.userId, t.kind)],
);

export const DISPATCH_STATUSES = ["pending", "sending", "sent", "failed", "skipped"] as const;
export type DispatchStatus = (typeof DISPATCH_STATUSES)[number];

// What a dispatch row announces: an open alert (ADR 0011) or a task that was
// just assigned to its recipient (ADR 0013).
export const NOTIFICATION_KINDS = ["alert", "task_assigned"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

// At-most-once e-mail outbox: one row per (alert, recipient, priority), sent
// by the notifier with a lease, retried with backoff, never sent twice.
export const notificationDispatch = pgTable(
  "notification_dispatch",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: NOTIFICATION_KINDS }).notNull().default("alert"),
    // Set for an alert notice; null for a task assignment.
    alertId: uuid("alert_id").references(() => alert.id, { onDelete: "cascade" }),
    // Set for a task assignment notice.
    taskId: uuid("task_id").references(() => task.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    channel: text("channel").notNull().default("email"),
    dedupKey: text("dedup_key").notNull(),
    status: text("status", { enum: DISPATCH_STATUSES }).notNull().default("pending"),
    priority: text("priority", { enum: ALERT_PRIORITIES }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    claimedUntil: timestamp("claimed_until", { withTimezone: true }),
    lastError: text("last_error"),
    provider: text("provider"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("notification_dispatch_dedup_idx").on(t.dedupKey),
    index("notification_dispatch_status_idx").on(t.status, t.nextRetryAt),
    index("notification_dispatch_alert_idx").on(t.alertId),
    index("notification_dispatch_task_idx").on(t.taskId),
    check(
      "notification_dispatch_subject_chk",
      sql`(kind = 'alert' AND alert_id IS NOT NULL) OR (kind = 'task_assigned' AND task_id IS NOT NULL)`,
    ),
  ],
);
