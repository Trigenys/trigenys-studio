import { relations, sql } from "drizzle-orm";
import {
  boolean,
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
  (t) => [index("task_transition_task_idx").on(t.taskId)],
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
