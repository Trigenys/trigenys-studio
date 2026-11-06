import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { audited } from "../auth/audit.ts";
import { authorize } from "../auth/middleware.ts";
import { OBJECTIVE_METRICS, contractObjective, product } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { idempotent } from "../idempotency.ts";
import { SOCIAL_CHANNELS } from "../integrations/types.ts";
import { ProblemError } from "../problem.ts";
import { serialiseObjective } from "../reporting/report.ts";
import { idParam, idempotencyHeader, jsonBody, problemResponse, security } from "./tasks.ts";

// Contract objectives: the monthly targets a product's contract promises
// (tasks completed, articles published, deliveries sent), optionally per task
// type or channel. Admin-managed, versioned, deactivated rather than deleted
// so past reports keep their reference (ADR 0010).

const iso = z.iso.datetime();

export const ContractObjectiveSchema = z
  .object({
    id: z.uuid(),
    productId: z.string(),
    metric: z.enum(OBJECTIVE_METRICS),
    taskType: z.string().nullable(),
    channel: z.string().nullable(),
    period: z.string(),
    target: z.number().int(),
    active: z.boolean(),
    version: z.number().int(),
    createdBy: z.string().nullable(),
    createdAt: iso,
    updatedAt: iso,
  })
  .openapi("ContractObjective");

const CreateObjectiveSchema = z
  .object({
    metric: z.enum(OBJECTIVE_METRICS),
    taskType: z.string().min(1).max(40).optional(),
    channel: z.enum(SOCIAL_CHANNELS).optional(),
    target: z.number().int().positive().max(100_000),
  })
  .openapi("CreateContractObjective");

const UpdateObjectiveSchema = z
  .object({
    version: z.number().int(),
    target: z.number().int().positive().max(100_000).optional(),
    active: z.boolean().optional(),
  })
  .openapi("UpdateContractObjective");

const productParam = z.object({ id: z.string().min(1) });

const listRoute = createRoute({
  method: "get",
  path: "/products/{id}/objectives",
  tags: ["reporting"],
  summary: "List the contract objectives of a product (active first)",
  security,
  middleware: [authorize("report.read", (c) => ({ type: "objective", productId: c.req.param("id") }))] as const,
  request: { params: productParam },
  responses: {
    200: { description: "Objectives", content: { "application/json": { schema: z.array(ContractObjectiveSchema) } } },
    401: problemResponse("No valid session"),
    403: problemResponse("No role on the product"),
    404: problemResponse("Unknown product"),
  },
});

const createObjective = createRoute({
  method: "post",
  path: "/products/{id}/objectives",
  tags: ["reporting"],
  summary: "Create a contract objective (admin, audited, idempotent)",
  security,
  middleware: [authorize("objective.manage", (c) => ({ type: "objective", productId: c.req.param("id") }))] as const,
  request: { params: productParam, headers: idempotencyHeader, body: jsonBody(CreateObjectiveSchema) },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: ContractObjectiveSchema } } },
    400: problemResponse("Invalid body or scope"),
    401: problemResponse("No valid session"),
    403: problemResponse("Not an admin"),
    404: problemResponse("Unknown product"),
    409: problemResponse("An active objective already covers this scope"),
    422: problemResponse("Idempotency-Key reused for a different request"),
  },
});

const updateObjective = createRoute({
  method: "patch",
  path: "/objectives/{id}",
  tags: ["reporting"],
  summary: "Change the target or deactivate an objective (admin, audited, optimistic version)",
  security,
  middleware: [
    authorize("objective.manage", async (c) => {
      const [row] = await c.var.db.select({ productId: contractObjective.productId }).from(contractObjective).where(eq(contractObjective.id, c.req.param("id")!));
      return { type: "objective", id: c.req.param("id"), productId: row?.productId ?? null };
    }),
  ] as const,
  request: { params: idParam, body: jsonBody(UpdateObjectiveSchema) },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: ContractObjectiveSchema } } },
    400: problemResponse("Invalid body"),
    401: problemResponse("No valid session"),
    403: problemResponse("Not an admin"),
    404: problemResponse("Unknown objective"),
    409: problemResponse("Version conflict"),
  },
});

const scopeOf = (body: z.infer<typeof CreateObjectiveSchema>) => {
  if (body.metric === "deliveries_sent" && body.taskType) throw new ProblemError(400, "Invalid scope", { detail: "deliveries_sent is scoped by channel, not task type" });
  if (body.metric !== "deliveries_sent" && body.channel) throw new ProblemError(400, "Invalid scope", { detail: `${body.metric} is not scoped by channel` });
  if (body.metric === "articles_published" && body.taskType) throw new ProblemError(400, "Invalid scope", { detail: "articles_published already targets articles" });
  return { taskType: body.taskType ?? null, channel: body.channel ?? null };
};

export const objectiveRoutes = new OpenAPIHono<AppEnv>()
  .openapi(listRoute, async (c) => {
    const { id } = c.req.valid("param");
    const [p] = await c.var.db.select({ id: product.id }).from(product).where(eq(product.id, id));
    if (!p) throw new ProblemError(404, "Unknown product");
    const rows = await c.var.db
      .select()
      .from(contractObjective)
      .where(eq(contractObjective.productId, id))
      .orderBy(sql`${contractObjective.active} desc`, asc(contractObjective.metric), asc(contractObjective.createdAt));
    return c.json(rows.map(serialiseObjective), 200);
  })
  .openapi(createObjective, async (c) => {
    const { id: productId } = c.req.valid("param");
    const body = c.req.valid("json");
    const scope = scopeOf(body);
    const db = c.var.db;
    const principal = c.var.principal!;
    const result = await idempotent(c, { productId, ...body }, async () => {
      const [p] = await db.select({ id: product.id }).from(product).where(eq(product.id, productId));
      if (!p) throw new ProblemError(404, "Unknown product");
      const [existing] = await db
        .select()
        .from(contractObjective)
        .where(
          and(
            eq(contractObjective.productId, productId),
            eq(contractObjective.metric, body.metric),
            eq(contractObjective.active, true),
            scope.taskType ? eq(contractObjective.taskType, scope.taskType) : isNull(contractObjective.taskType),
            scope.channel ? eq(contractObjective.channel, scope.channel) : isNull(contractObjective.channel),
          ),
        );
      if (existing) {
        throw new ProblemError(409, "Objective already defined", {
          detail: `An active objective (${existing.id}) already targets ${body.metric} for this scope; change its target or deactivate it first`,
        });
      }
      const row = await audited(
        db,
        {
          actor: principal,
          action: "objective.manage",
          resource: { type: "objective", productId },
          requestId: c.var.requestId,
          details: { op: "create", ...body },
        },
        async (tx) => (await tx.insert(contractObjective).values({ productId, metric: body.metric, ...scope, target: body.target, createdBy: principal.userId }).returning())[0]!,
      );
      return { status: 201 as const, body: serialiseObjective(row) };
    });
    return c.json(result.body, result.status);
  })
  .openapi(updateObjective, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const db = c.var.db;
    const [current] = await db.select().from(contractObjective).where(eq(contractObjective.id, id));
    if (!current) throw new ProblemError(404, "Unknown objective");
    if (current.version !== body.version) throw new ProblemError(409, "Version conflict", { detail: `Current version is ${current.version}` });
    const patch = { target: body.target ?? current.target, active: body.active ?? current.active };
    if (patch.target === current.target && patch.active === current.active) return c.json(serialiseObjective(current), 200);
    const row = await audited(
      db,
      {
        actor: c.var.principal!,
        action: "objective.manage",
        resource: { type: "objective", id, productId: current.productId },
        requestId: c.var.requestId,
        details: { op: "update", from: { target: current.target, active: current.active }, to: patch },
      },
      async (tx) => {
        const [updated] = await tx
          .update(contractObjective)
          .set({ ...patch, version: current.version + 1, updatedAt: new Date() })
          .where(and(eq(contractObjective.id, id), eq(contractObjective.version, current.version)))
          .returning();
        if (!updated) throw new ProblemError(409, "Version conflict", { detail: "The objective changed concurrently" });
        return updated;
      },
    );
    return c.json(serialiseObjective(row), 200);
  });
