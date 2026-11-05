import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, asc, eq, inArray } from "drizzle-orm";
import { audited } from "../auth/audit.ts";
import { authorize } from "../auth/middleware.ts";
import type { Principal } from "../auth/rbac.ts";
import { SOCIAL_PROVIDERS, product, socialAccount } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { idempotent } from "../idempotency.ts";
import { SOCIAL_CHANNELS } from "../integrations/types.ts";
import { ProblemError } from "../problem.ts";
import type { SocialAccountRow } from "../publishing/readiness.ts";
import { idParam, idempotencyHeader, jsonBody, problemResponse, security } from "./tasks.ts";

// Social accounts: the mapping between a product's channel and the account
// the provider knows (a Buffer channel id). Admin-managed, never deleted:
// deliveries reference them, so an account is deactivated instead.

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const iso = z.iso.datetime();

export const SocialAccountSchema = z
  .object({
    id: z.uuid(),
    productId: z.string(),
    channel: z.enum(SOCIAL_CHANNELS),
    provider: z.enum(SOCIAL_PROVIDERS),
    externalRef: z.string(),
    handle: z.string(),
    displayName: z.string(),
    active: z.boolean(),
    version: z.number().int(),
    createdBy: z.string().nullable(),
    createdAt: iso,
    updatedAt: iso,
  })
  .openapi("SocialAccount");

export const CreateSocialAccountSchema = z
  .object({
    productId: z.string().min(1),
    channel: z.enum(SOCIAL_CHANNELS),
    provider: z.enum(SOCIAL_PROVIDERS),
    externalRef: z.string().min(1).max(200).openapi({ description: "The provider's own id for the channel" }),
    handle: z.string().min(1).max(120),
    displayName: z.string().min(1).max(200),
  })
  .openapi("CreateSocialAccount");

export const UpdateSocialAccountSchema = z
  .object({
    active: z.boolean().optional(),
    handle: z.string().min(1).max(120).optional(),
    displayName: z.string().min(1).max(200).optional(),
    version: z.number().int(),
  })
  .openapi("UpdateSocialAccount");

export const ProviderAccountSchema = z
  .object({ externalRef: z.string(), service: z.string(), name: z.string() })
  .openapi("ProviderAccount");

const ListQuery = z.object({ productId: z.string().optional(), channel: z.enum(SOCIAL_CHANNELS).optional() });

export const serialiseAccount = (a: SocialAccountRow) => ({
  ...a,
  channel: a.channel as (typeof SOCIAL_CHANNELS)[number],
  createdAt: a.createdAt.toISOString(),
  updatedAt: a.updatedAt.toISOString(),
});

const readableProducts = (p: Principal): string[] | null =>
  p.grants.some((g) => g.productId === null) ? null : [...new Set(p.grants.map((g) => g.productId!))];

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const listAccounts = createRoute({
  method: "get",
  path: "/social-accounts",
  tags: ["publishing"],
  summary: "Social accounts visible to the caller (filters: product, channel)",
  security,
  middleware: [authorize("social.read", () => ({ type: "social_account" }))] as const,
  request: { query: ListQuery },
  responses: {
    200: { description: "Accounts", content: { "application/json": { schema: z.array(SocialAccountSchema) } } },
    401: problemResponse("No valid session"),
    403: problemResponse("No role"),
  },
});

const providerChannels = createRoute({
  method: "get",
  path: "/social-accounts/provider-channels",
  tags: ["publishing"],
  summary: "Channels the configured publisher exposes, to map them to products",
  security,
  middleware: [authorize("social.manage", () => ({ type: "social_account" }))] as const,
  responses: {
    200: { description: "Provider channels", content: { "application/json": { schema: z.array(ProviderAccountSchema) } } },
    401: problemResponse("No valid session"),
    403: problemResponse("Admins only"),
    501: problemResponse("The configured publisher does not list its channels"),
    502: problemResponse("The provider could not be reached"),
  },
});

const createAccount = createRoute({
  method: "post",
  path: "/social-accounts",
  tags: ["publishing"],
  summary: "Map a provider channel to a product (admin, audited, Idempotency-Key)",
  security,
  middleware: [
    authorize("social.manage", async (c) => {
      const body = (await c.req.raw.clone().json().catch(() => null)) as { productId?: unknown } | null;
      return { type: "social_account", productId: typeof body?.productId === "string" ? body.productId : undefined };
    }),
  ] as const,
  request: { body: jsonBody(CreateSocialAccountSchema), headers: idempotencyHeader },
  responses: {
    200: { description: "Already mapped identically", content: { "application/json": { schema: SocialAccountSchema } } },
    201: { description: "Created", content: { "application/json": { schema: SocialAccountSchema } } },
    400: problemResponse("Invalid body"),
    401: problemResponse("No valid session"),
    403: problemResponse("Admins only"),
    404: problemResponse("Unknown product"),
    409: problemResponse("This provider channel is already mapped with other attributes"),
    422: problemResponse("Idempotency-Key reused for a different request"),
  },
});

const updateAccount = createRoute({
  method: "patch",
  path: "/social-accounts/{id}",
  tags: ["publishing"],
  summary: "Rename or (de)activate a social account (admin, audited, optimistic version)",
  security,
  middleware: [
    authorize("social.manage", async (c) => {
      const id = c.req.param("id") ?? "";
      if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
      const [row] = await c.var.db.select({ productId: socialAccount.productId }).from(socialAccount).where(eq(socialAccount.id, id));
      return row ? { type: "social_account", id, productId: row.productId } : null;
    }),
  ] as const,
  request: { params: idParam, body: jsonBody(UpdateSocialAccountSchema) },
  responses: {
    200: { description: "Account", content: { "application/json": { schema: SocialAccountSchema } } },
    400: problemResponse("Invalid body"),
    401: problemResponse("No valid session"),
    403: problemResponse("Admins only"),
    404: problemResponse("Unknown account"),
    409: problemResponse("Version conflict"),
  },
});

export const socialAccountRoutes = new OpenAPIHono<AppEnv>()
  .openapi(listAccounts, async (c) => {
    const q = c.req.valid("query");
    const scope = readableProducts(c.var.principal!);
    const where = [];
    if (scope) where.push(inArray(socialAccount.productId, scope.length ? scope : ["-"]));
    if (q.productId) where.push(eq(socialAccount.productId, q.productId));
    if (q.channel) where.push(eq(socialAccount.channel, q.channel));
    const rows = await c.var.db
      .select()
      .from(socialAccount)
      .where(where.length ? and(...where) : undefined)
      .orderBy(asc(socialAccount.productId), asc(socialAccount.channel), asc(socialAccount.handle));
    return c.json(rows.map(serialiseAccount), 200);
  })

  .openapi(providerChannels, async (c) => {
    const publisher = c.var.integrations.publisher;
    if (!publisher.listAccounts) {
      throw new ProblemError(501, "Not supported", { detail: `Publisher "${publisher.name}" does not list its channels` });
    }
    const accounts = await publisher.listAccounts().catch((e: unknown) => {
      throw new ProblemError(502, "Provider unavailable", { detail: e instanceof Error ? e.message : String(e) });
    });
    return c.json(accounts, 200);
  })

  .openapi(createAccount, async (c) => {
    const body = c.req.valid("json");
    const principal = c.var.principal!;
    const db = c.var.db;
    const result = await idempotent(c, body, async () => {
      const [p] = await db.select({ id: product.id }).from(product).where(eq(product.id, body.productId));
      if (!p) throw new ProblemError(404, "Unknown product", { detail: `No product "${body.productId}"` });
      const [existing] = await db
        .select()
        .from(socialAccount)
        .where(and(eq(socialAccount.productId, body.productId), eq(socialAccount.provider, body.provider), eq(socialAccount.externalRef, body.externalRef)));
      if (existing) {
        const same = existing.channel === body.channel && existing.handle === body.handle && existing.displayName === body.displayName;
        if (same) return { status: 200 as const, body: serialiseAccount(existing) };
        throw new ProblemError(409, "Already mapped", { detail: `Channel ${body.externalRef} is already mapped as ${existing.handle} (${existing.channel})` });
      }
      const row = await audited(
        db,
        {
          actor: principal,
          action: "social_account.create",
          resource: { type: "social_account", productId: body.productId },
          requestId: c.var.requestId,
          details: { channel: body.channel, provider: body.provider, externalRef: body.externalRef, handle: body.handle },
        },
        async (tx) => {
          const [inserted] = await tx
            .insert(socialAccount)
            .values({ ...body, createdBy: principal.userId })
            .returning();
          return inserted!;
        },
      );
      return { status: 201 as const, body: serialiseAccount(row) };
    });
    return c.json(result.body, result.status);
  })

  .openapi(updateAccount, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const principal = c.var.principal!;
    const db = c.var.db;
    const [current] = await db.select().from(socialAccount).where(eq(socialAccount.id, id));
    if (!current) throw new ProblemError(404, "Unknown account");
    if (current.version !== body.version) throw new ProblemError(409, "Version conflict", { detail: `Current version is ${current.version}` });
    const patch = {
      active: body.active ?? current.active,
      handle: body.handle ?? current.handle,
      displayName: body.displayName ?? current.displayName,
    };
    if (patch.active === current.active && patch.handle === current.handle && patch.displayName === current.displayName) {
      return c.json(serialiseAccount(current), 200);
    }
    const row = await audited(
      db,
      {
        actor: principal,
        action: "social_account.update",
        resource: { type: "social_account", id, productId: current.productId },
        requestId: c.var.requestId,
        details: { from: { active: current.active, handle: current.handle, displayName: current.displayName }, to: patch },
      },
      async (tx) => {
        const [updated] = await tx
          .update(socialAccount)
          .set({ ...patch, version: current.version + 1, updatedAt: new Date() })
          .where(and(eq(socialAccount.id, id), eq(socialAccount.version, current.version)))
          .returning();
        if (!updated) throw new ProblemError(409, "Version conflict", { detail: "The account changed concurrently" });
        return updated;
      },
    );
    return c.json(serialiseAccount(row), 200);
  });
