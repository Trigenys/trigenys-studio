import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, eq, isNull } from "drizzle-orm";
import { audited } from "../auth/audit.ts";
import { authorize } from "../auth/middleware.ts";
import { ROLES, roleAssignment, user } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { ProblemError, ProblemSchema } from "../problem.ts";
import { RoleGrantSchema } from "./me.ts";

const RoleAssignmentSchema = z
  .object({
    id: z.uuid(),
    userId: z.string(),
    role: z.enum(ROLES),
    productId: z.string().nullable(),
    grantedBy: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .openapi("RoleAssignment");

const GrantRoleSchema = z
  .object({
    userId: z.string().min(1),
    role: z.enum(ROLES),
    productId: z.string().min(1).nullable().default(null),
  })
  .openapi("GrantRole");

const problemResponse = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: ProblemSchema } },
});

const security: Record<string, string[]>[] = [{ cookieAuth: [] }, { bearerAuth: [] }];

const listRoute = createRoute({
  method: "get",
  path: "/roles",
  tags: ["identity"],
  summary: "List role assignments (admin)",
  security,
  middleware: [authorize("role.read", () => ({ type: "role" }))] as const,
  responses: {
    200: {
      description: "Assignments",
      content: { "application/json": { schema: z.array(RoleAssignmentSchema) } },
    },
    401: problemResponse("No valid session"),
    403: problemResponse("Not an admin"),
  },
});

const grantRoute = createRoute({
  method: "post",
  path: "/roles",
  tags: ["identity"],
  summary: "Grant a role to a user (admin, audited)",
  security,
  middleware: [authorize("role.grant", () => ({ type: "role" }))] as const,
  request: { body: { content: { "application/json": { schema: GrantRoleSchema } }, required: true } },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: RoleAssignmentSchema } } },
    200: { description: "Already granted", content: { "application/json": { schema: RoleAssignmentSchema } } },
    400: problemResponse("Invalid body"),
    401: problemResponse("No valid session"),
    403: problemResponse("Not an admin"),
    404: problemResponse("Unknown user"),
  },
});

const revokeRoute = createRoute({
  method: "delete",
  path: "/roles/{id}",
  tags: ["identity"],
  summary: "Revoke a role assignment (admin, audited)",
  security,
  middleware: [
    authorize("role.revoke", async (c) => {
      const id = c.req.param("id") ?? "";
      const [row] = await c.var.db.select().from(roleAssignment).where(eq(roleAssignment.id, id));
      return row ? { type: "role", id: row.id, productId: row.productId } : null;
    }),
  ] as const,
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    204: { description: "Revoked" },
    401: problemResponse("No valid session"),
    403: problemResponse("Not an admin"),
    404: problemResponse("Unknown assignment"),
  },
});

const serialise = (row: typeof roleAssignment.$inferSelect) => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
});

export const roleRoutes = new OpenAPIHono<AppEnv>()
  .openapi(listRoute, async (c) => {
    const rows = await c.var.db.select().from(roleAssignment);
    return c.json(rows.map(serialise), 200);
  })
  .openapi(grantRoute, async (c) => {
    const body = c.req.valid("json");
    const db = c.var.db;
    const [target] = await db.select({ id: user.id }).from(user).where(eq(user.id, body.userId));
    if (!target) throw new ProblemError(404, "Unknown user");

    // Idempotent: granting an existing (user, role, product) returns it unchanged.
    const existing = await db
      .select()
      .from(roleAssignment)
      .where(
        and(
          eq(roleAssignment.userId, body.userId),
          eq(roleAssignment.role, body.role),
          body.productId === null ? isNull(roleAssignment.productId) : eq(roleAssignment.productId, body.productId),
        ),
      );
    if (existing[0]) return c.json(serialise(existing[0]), 200);

    const created = await audited(
      db,
      {
        actor: c.var.principal,
        action: "role.grant",
        resource: { type: "role", productId: body.productId },
        requestId: c.var.requestId,
        details: { userId: body.userId, role: body.role, productId: body.productId },
      },
      async (tx) => {
        const [row] = await tx
          .insert(roleAssignment)
          .values({ ...body, grantedBy: c.var.principal!.userId })
          .returning();
        return row!;
      },
    );
    return c.json(serialise(created), 201);
  })
  .openapi(revokeRoute, async (c) => {
    const { id } = c.req.valid("param");
    await audited(
      c.var.db,
      { actor: c.var.principal, action: "role.revoke", resource: { type: "role", id }, requestId: c.var.requestId },
      (tx) => tx.delete(roleAssignment).where(eq(roleAssignment.id, id)),
    );
    return c.body(null, 204);
  });

export { RoleGrantSchema };
