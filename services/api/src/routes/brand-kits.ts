import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, desc, eq } from "drizzle-orm";
import type { Context } from "hono";
import { audited } from "../auth/audit.ts";
import { authorize } from "../auth/middleware.ts";
import type { Db } from "../db/client.ts";
import { BRAND_KIT_STATUSES, brandKit, product, visualFormat } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { idempotent } from "../idempotency.ts";
import { ProblemError } from "../problem.ts";
import { approvedKitOf, kitHashOf, logoKeyOf, LOGO_MAX_BYTES, LOGO_MIMES, type BrandKitRow } from "../visuals/brand-kit.ts";
import { fromBase64, sha256Bytes } from "../visuals/canonical.ts";
import { stableStringify } from "../visuals/canonical.ts";
import { UpsertVisualFormatSchema, VisualFormatSchema, serialiseFormat } from "../visuals/formats.ts";
import { idParam, idempotencyHeader, jsonBody, problemResponse, security } from "./tasks.ts";

// Formats are configuration (what sizes exist); brand kits are the approved
// identity of a product, versioned and immutable once approved so a render
// can always say which kit it came from.

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const PaletteSchema = z
  .object({
    primary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    secondary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    text: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  })
  .openapi("BrandPalette");

export const BrandKitSchema = z
  .object({
    id: z.uuid(),
    productId: z.string(),
    n: z.number().int(),
    name: z.string(),
    status: z.enum(BRAND_KIT_STATUSES),
    palette: PaletteSchema,
    fontFamily: z.string(),
    defaultTitle: z.string().nullable(),
    mentions: z.string(),
    logoMime: z.string(),
    logoHash: z.string(),
    logoBytes: z.number().int(),
    kitHash: z.string(),
    createdBy: z.string().nullable(),
    createdAt: z.string(),
    approvedBy: z.string().nullable(),
    approvedAt: z.string().nullable(),
    retiredAt: z.string().nullable(),
  })
  .openapi("BrandKit");

const CreateBrandKitSchema = z
  .object({
    name: z.string().min(1).max(80),
    palette: PaletteSchema,
    fontFamily: z.string().min(1).max(80).default("Inter, Arial, sans-serif"),
    defaultTitle: z.string().max(200).nullable().default(null),
    mentions: z.string().max(200).default(""),
    logo: z.object({
      mime: z.enum(LOGO_MIMES),
      // base64 of the file; the API hashes and stores the bytes itself.
      base64: z.string().min(1).max(Math.ceil((LOGO_MAX_BYTES * 4) / 3) + 4),
    }),
  })
  .openapi("CreateBrandKit");

const productParam = z.object({ productId: z.string().min(1) });
const formatParam = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/) });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const serialiseKit = (k: BrandKitRow) => {
  const { logoKey: _key, ...rest } = k;
  return {
    ...rest,
    createdAt: k.createdAt.toISOString(),
    approvedAt: k.approvedAt?.toISOString() ?? null,
    retiredAt: k.retiredAt?.toISOString() ?? null,
  };
};

const productResource = (c: Context<AppEnv>) => {
  const id = c.req.param("productId") ?? "-";
  return { type: "product" as const, id, productId: id };
};

const kitResource = async (c: Context<AppEnv>) => {
  const id = c.req.param("id") ?? "";
  const [row] = UUID.test(id) ? await c.var.db.select().from(brandKit).where(eq(brandKit.id, id)) : [];
  if (!row) throw new ProblemError(404, "Unknown brand kit");
  return { type: "product" as const, id: row.productId, productId: row.productId };
};

const kitOr404 = async (db: Db, id: string): Promise<BrandKitRow> => {
  const [row] = UUID.test(id) ? await db.select().from(brandKit).where(eq(brandKit.id, id)) : [];
  if (!row) throw new ProblemError(404, "Unknown brand kit");
  return row;
};

const productOr404 = async (db: Db, id: string) => {
  const [row] = await db.select({ id: product.id }).from(product).where(eq(product.id, id));
  if (!row) throw new ProblemError(404, "Unknown product");
  return row;
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const listFormats = createRoute({
  method: "get",
  path: "/visual-formats",
  tags: ["visuals"],
  summary: "Visual formats (sizes and layouts) available for rendering",
  security,
  middleware: [authorize("product.read", () => ({ type: "product" }))] as const,
  request: { query: z.object({ include: z.enum(["inactive"]).optional() }) },
  responses: {
    200: { description: "Formats", content: { "application/json": { schema: z.array(VisualFormatSchema) } } },
    401: problemResponse("No valid session"),
    403: problemResponse("Not allowed"),
  },
});

const upsertFormat = createRoute({
  method: "put",
  path: "/visual-formats/{id}",
  tags: ["visuals"],
  summary: "Create or update a visual format (admin, audited, converges: no write when nothing changes)",
  security,
  middleware: [authorize("product.manage", () => ({ type: "product" }))] as const,
  request: { params: formatParam, body: jsonBody(UpsertVisualFormatSchema) },
  responses: {
    200: { description: "Format as stored", content: { "application/json": { schema: VisualFormatSchema } } },
    201: { description: "Format created", content: { "application/json": { schema: VisualFormatSchema } } },
    400: problemResponse("Invalid body"),
    401: problemResponse("No valid session"),
    403: problemResponse("Not an admin"),
  },
});

const listKits = createRoute({
  method: "get",
  path: "/products/{productId}/brand-kits",
  tags: ["visuals"],
  summary: "Brand kits of a product, newest first",
  security,
  middleware: [authorize("product.read", productResource)] as const,
  request: { params: productParam },
  responses: {
    200: { description: "Kits", content: { "application/json": { schema: z.array(BrandKitSchema) } } },
    401: problemResponse("No valid session"),
    403: problemResponse("Not allowed on this product"),
    404: problemResponse("Unknown product"),
  },
});

const createKit = createRoute({
  method: "post",
  path: "/products/{productId}/brand-kits",
  tags: ["visuals"],
  summary: "Add a draft brand kit with its logo (admin, audited, Idempotency-Key)",
  security,
  middleware: [authorize("product.manage", productResource)] as const,
  request: { params: productParam, body: jsonBody(CreateBrandKitSchema), headers: idempotencyHeader },
  responses: {
    201: { description: "Draft kit", content: { "application/json": { schema: BrandKitSchema } } },
    400: problemResponse("Invalid body"),
    401: problemResponse("No valid session"),
    403: problemResponse("Not an admin"),
    404: problemResponse("Unknown product"),
    413: problemResponse("Logo too large"),
    422: problemResponse("Logo is not a valid file of the declared type, or Idempotency-Key reused"),
  },
});

const approveKit = createRoute({
  method: "post",
  path: "/brand-kits/{id}/approve",
  tags: ["visuals"],
  summary: "Approve a draft kit; the previously approved kit of the product is retired (admin, audited)",
  security,
  middleware: [authorize("product.manage", kitResource)] as const,
  request: { params: idParam },
  responses: {
    200: { description: "Approved kit", content: { "application/json": { schema: BrandKitSchema } } },
    401: problemResponse("No valid session"),
    403: problemResponse("Not an admin"),
    404: problemResponse("Unknown brand kit"),
    409: problemResponse("Kit is retired"),
  },
});

const getLogo = createRoute({
  method: "get",
  path: "/brand-kits/{id}/logo",
  tags: ["visuals"],
  summary: "Logo bytes of a kit",
  security,
  middleware: [authorize("product.read", kitResource)] as const,
  request: { params: idParam },
  responses: {
    200: { description: "Logo", content: { "image/svg+xml": { schema: z.string() }, "image/png": { schema: z.string().openapi({ format: "binary" }) } } },
    401: problemResponse("No valid session"),
    403: problemResponse("Not allowed"),
    404: problemResponse("Unknown brand kit or logo missing"),
  },
});

const sameFormat = (row: typeof visualFormat.$inferSelect, body: z.infer<typeof UpsertVisualFormatSchema>) =>
  row.label === body.label &&
  row.width === body.width &&
  row.height === body.height &&
  row.channel === (body.channel ?? null) &&
  row.active === (body.active ?? true) &&
  stableStringify(row.layout) === stableStringify(body.layout);

// Cheap structural check so a PNG declared as SVG (or the reverse) is refused.
const looksLike = (mime: string, bytes: Uint8Array): boolean => {
  if (mime === "image/png") return bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const head = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart();
  return head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"));
};

export const brandKitRoutes = new OpenAPIHono<AppEnv>()
  .openapi(listFormats, async (c) => {
    const { include } = c.req.valid("query");
    const rows = await c.var.db
      .select()
      .from(visualFormat)
      .where(include === "inactive" ? undefined : eq(visualFormat.active, true))
      .orderBy(visualFormat.id);
    return c.json(rows.map(serialiseFormat), 200);
  })

  .openapi(upsertFormat, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const db = c.var.db;
    const [existing] = await db.select().from(visualFormat).where(eq(visualFormat.id, id));
    if (existing && sameFormat(existing, body)) return c.json(serialiseFormat(existing), 200);
    const values = { label: body.label, width: body.width, height: body.height, channel: body.channel ?? null, layout: body.layout, active: body.active ?? true };
    const row = await audited(
      db,
      { actor: c.var.principal, action: "visualformat.upsert", resource: { type: "product", id }, requestId: c.var.requestId, details: { created: !existing, ...values } },
      async (tx) =>
        existing
          ? (await tx.update(visualFormat).set({ ...values, updatedAt: new Date() }).where(eq(visualFormat.id, id)).returning())[0]!
          : (await tx.insert(visualFormat).values({ id, ...values }).returning())[0]!,
    );
    return c.json(serialiseFormat(row), existing ? 200 : 201);
  })

  .openapi(listKits, async (c) => {
    const { productId } = c.req.valid("param");
    await productOr404(c.var.db, productId);
    const rows = await c.var.db.select().from(brandKit).where(eq(brandKit.productId, productId)).orderBy(desc(brandKit.n));
    return c.json(rows.map(serialiseKit), 200);
  })

  .openapi(createKit, async (c) => {
    const { productId } = c.req.valid("param");
    const body = c.req.valid("json");
    const principal = c.var.principal!;
    const result = await idempotent(c, { productId, ...body }, async () => {
      await productOr404(c.var.db, productId);
      let bytes: Uint8Array;
      try {
        bytes = fromBase64(body.logo.base64);
      } catch {
        throw new ProblemError(422, "Logo is not valid base64");
      }
      if (bytes.length > LOGO_MAX_BYTES) throw new ProblemError(413, "Logo too large", { detail: `${bytes.length} bytes, maximum ${LOGO_MAX_BYTES}` });
      if (bytes.length === 0 || !looksLike(body.logo.mime, bytes)) throw new ProblemError(422, "Logo does not match its declared type", { detail: body.logo.mime });
      const logoHash = await sha256Bytes(bytes);
      const logoKey = logoKeyOf(logoHash, body.logo.mime);
      const kitHash = await kitHashOf({ palette: body.palette, fontFamily: body.fontFamily, defaultTitle: body.defaultTitle, mentions: body.mentions, logoHash });
      // The logo is stored before the row: a stored object without a row is
      // harmless (content-addressed), a row without its object is not.
      await c.var.integrations.media.put(logoKey, bytes, body.logo.mime);
      const row = await audited(
        c.var.db,
        {
          actor: principal,
          action: "brandkit.create",
          resource: { type: "product", id: productId, productId },
          requestId: c.var.requestId,
          details: { name: body.name, kitHash, logoHash },
        },
        async (tx) => {
          const [last] = await tx.select({ n: brandKit.n }).from(brandKit).where(eq(brandKit.productId, productId)).orderBy(desc(brandKit.n)).limit(1).for("update");
          const [created] = await tx
            .insert(brandKit)
            .values({
              productId,
              n: (last?.n ?? 0) + 1,
              name: body.name,
              palette: body.palette,
              fontFamily: body.fontFamily,
              defaultTitle: body.defaultTitle,
              mentions: body.mentions,
              logoKey,
              logoMime: body.logo.mime,
              logoHash,
              logoBytes: bytes.length,
              kitHash,
              createdBy: principal.userId,
            })
            .returning();
          return created!;
        },
      );
      return { status: 201 as const, body: serialiseKit(row) };
    });
    return c.json(result.body, result.status);
  })

  .openapi(approveKit, async (c) => {
    const { id } = c.req.valid("param");
    const principal = c.var.principal!;
    const kit = await kitOr404(c.var.db, id);
    if (kit.status === "approved") return c.json(serialiseKit(kit), 200);
    if (kit.status === "retired") throw new ProblemError(409, "Kit is retired", { detail: "A retired kit cannot be approved again; create a new version" });
    const row = await audited(
      c.var.db,
      {
        actor: principal,
        action: "brandkit.approve",
        resource: { type: "product", id: kit.productId, productId: kit.productId },
        requestId: c.var.requestId,
        details: { kitId: kit.id, n: kit.n, kitHash: kit.kitHash },
      },
      async (tx) => {
        const previous = await approvedKitOf(tx, kit.productId);
        if (previous) {
          await tx.update(brandKit).set({ status: "retired", retiredAt: new Date() }).where(and(eq(brandKit.id, previous.id), eq(brandKit.status, "approved")));
        }
        const [approved] = await tx
          .update(brandKit)
          .set({ status: "approved", approvedBy: principal.userId, approvedAt: new Date() })
          .where(and(eq(brandKit.id, kit.id), eq(brandKit.status, "draft")))
          .returning();
        if (!approved) throw new ProblemError(409, "Kit changed concurrently");
        return approved;
      },
    );
    return c.json(serialiseKit(row), 200);
  })

  .openapi(getLogo, async (c) => {
    const { id } = c.req.valid("param");
    const kit = await kitOr404(c.var.db, id);
    const object = await c.var.integrations.media.get(kit.logoKey);
    if (!object) throw new ProblemError(404, "Logo missing from the media store");
    return c.body(object.bytes as unknown as ArrayBuffer, 200, {
      "content-type": kit.logoMime,
      "cache-control": "private, max-age=31536000, immutable",
      etag: `"${kit.logoHash}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    });
  });
