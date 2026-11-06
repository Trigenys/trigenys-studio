import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { audited } from "../auth/audit.ts";
import { authorize } from "../auth/middleware.ts";
import { product } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { ProblemError, ProblemSchema } from "../problem.ts";

export const ProductSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    seoMonitorUrl: z.string().nullable().openapi({ description: "External SEO Monitor page for this product (ADR 0010)" }),
    createdAt: z.iso.datetime(),
  })
  .openapi("Product");

const UpdateProductSchema = z
  .object({
    seoMonitorUrl: z.url({ protocol: /^https$/ }).max(500).nullable(),
  })
  .openapi("UpdateProduct");

const CreateProductSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{1,62}$/, "lowercase slug")
      .openapi({ example: "insight" }),
    name: z.string().min(1).max(120),
  })
  .openapi("CreateProduct");

const problemResponse = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: ProblemSchema } },
});

const security: Record<string, string[]>[] = [{ cookieAuth: [] }, { bearerAuth: [] }];

const listRoute = createRoute({
  method: "get",
  path: "/products",
  tags: ["pipeline"],
  summary: "List products",
  security,
  middleware: [authorize("product.read", () => ({ type: "product" }))] as const,
  responses: {
    200: { description: "Products", content: { "application/json": { schema: z.array(ProductSchema) } } },
    401: problemResponse("No valid session"),
    403: problemResponse("No role"),
  },
});

const createRoute_ = createRoute({
  method: "post",
  path: "/products",
  tags: ["pipeline"],
  summary: "Create a product (admin, audited, idempotent on id)",
  security,
  middleware: [authorize("product.manage", () => ({ type: "product" }))] as const,
  request: { body: { content: { "application/json": { schema: CreateProductSchema } }, required: true } },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: ProductSchema } } },
    200: { description: "Already exists with the same name", content: { "application/json": { schema: ProductSchema } } },
    400: problemResponse("Invalid body"),
    401: problemResponse("No valid session"),
    403: problemResponse("Not an admin"),
    409: problemResponse("Id already used with another name"),
  },
});

const updateRoute = createRoute({
  method: "patch",
  path: "/products/{id}",
  tags: ["pipeline"],
  summary: "Update a product's settings (admin, audited)",
  security,
  middleware: [authorize("product.manage", (c) => ({ type: "product", id: c.req.param("id"), productId: c.req.param("id") }))] as const,
  request: { params: z.object({ id: z.string().min(1) }), body: { content: { "application/json": { schema: UpdateProductSchema } }, required: true } },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: ProductSchema } } },
    400: problemResponse("Invalid body (https URL expected)"),
    401: problemResponse("No valid session"),
    403: problemResponse("Not an admin"),
    404: problemResponse("Unknown product"),
  },
});

const serialise = (row: typeof product.$inferSelect) => ({ ...row, createdAt: row.createdAt.toISOString() });

export const productRoutes = new OpenAPIHono<AppEnv>()
  .openapi(listRoute, async (c) => {
    const rows = await c.var.db.select().from(product).orderBy(product.name);
    return c.json(rows.map(serialise), 200);
  })
  .openapi(createRoute_, async (c) => {
    const body = c.req.valid("json");
    const [existing] = await c.var.db.select().from(product).where(eq(product.id, body.id));
    if (existing) {
      if (existing.name === body.name) return c.json(serialise(existing), 200);
      throw new ProblemError(409, "Product id already used", { detail: `"${body.id}" is named "${existing.name}"` });
    }
    const created = await audited(
      c.var.db,
      {
        actor: c.var.principal,
        action: "product.manage",
        resource: { type: "product", id: body.id, productId: body.id },
        requestId: c.var.requestId,
        details: { name: body.name },
      },
      async (tx) => (await tx.insert(product).values(body).returning())[0]!,
    );
    return c.json(serialise(created), 201);
  })
  .openapi(updateRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const [existing] = await c.var.db.select().from(product).where(eq(product.id, id));
    if (!existing) throw new ProblemError(404, "Unknown product");
    if (existing.seoMonitorUrl === body.seoMonitorUrl) return c.json(serialise(existing), 200);
    const updated = await audited(
      c.var.db,
      {
        actor: c.var.principal,
        action: "product.manage",
        resource: { type: "product", id, productId: id },
        requestId: c.var.requestId,
        details: { seoMonitorUrl: body.seoMonitorUrl },
      },
      async (tx) => (await tx.update(product).set({ seoMonitorUrl: body.seoMonitorUrl }).where(eq(product.id, id)).returning())[0]!,
    );
    return c.json(serialise(updated), 200);
  });
