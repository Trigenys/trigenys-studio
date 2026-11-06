import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { asc, inArray } from "drizzle-orm";
import { audited } from "../auth/audit.ts";
import { authorize } from "../auth/middleware.ts";
import { readableProducts } from "../auth/rbac.ts";
import { METRIC_TARGET_KINDS, product } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { idempotent } from "../idempotency.ts";
import { integrationModes } from "../integrations/registry.ts";
import { ProblemError } from "../problem.ts";
import { metricsTuning } from "../publishing/scheduled.ts";
import { MONTH_RE, monthOf } from "../reporting/period.ts";
import { refreshMetrics } from "../reporting/refresh.ts";
import { buildOperationalReport, serialiseObjective as serialise } from "../reporting/report.ts";
import { notConnectedReason, verifiedSection } from "../reporting/verified.ts";
import { ContractObjectiveSchema } from "./objectives.ts";
import { idempotencyHeader, jsonBody, problemResponse, security } from "./tasks.ts";

// Editorial report (ADR 0010): one month, UTC, two regimes that never mix.
// `operational` and `objectives` are counted from Studio's own tables;
// `verified` carries only snapshots of a verified provider, with provenance,
// or says the provider is not connected. A mock is never reported.

const iso = z.iso.datetime();

export const TaskCountsSchema = z
  .object({ productId: z.string(), type: z.string(), due: z.number().int(), done: z.number().int(), late: z.number().int() })
  .openapi("TaskCounts");

export const PublishedArticleSchema = z
  .object({ taskId: z.uuid(), productId: z.string(), title: z.string(), publishedAt: iso, url: z.string().nullable() })
  .openapi("PublishedArticle");

export const ChannelCampaignSchema = z
  .object({
    productId: z.string(),
    channel: z.string(),
    scheduled: z.number().int(),
    handedOff: z.number().int(),
    sent: z.number().int(),
    failed: z.number().int(),
    cancelled: z.number().int(),
  })
  .openapi("ChannelCampaign");

export const ObjectiveProgressSchema = z
  .object({ objective: ContractObjectiveSchema, actual: z.number().int(), ratio: z.number() })
  .openapi("ObjectiveProgress");

export const MetricSnapshotSchema = z
  .object({
    targetKind: z.enum(METRIC_TARGET_KINDS),
    targetRef: z.string(),
    provider: z.string(),
    measuredAt: iso,
    fetchedAt: iso,
    metrics: z.record(z.string(), z.number()),
  })
  .openapi("MetricSnapshot");

export const VerifiedMetricsSchema = z
  .discriminatedUnion("status", [
    z.object({ productId: z.string(), status: z.literal("not_connected"), reason: z.string() }),
    z.object({
      productId: z.string(),
      status: z.literal("connected"),
      provider: z.string(),
      snapshots: z.array(MetricSnapshotSchema),
      totals: z.record(z.string(), z.number()),
    }),
  ])
  .openapi("VerifiedMetrics");

export const ReportProductSchema = z.object({ id: z.string(), name: z.string(), seoMonitorUrl: z.string().nullable() }).openapi("ReportProduct");

export const EditorialReportSchema = z
  .object({
    month: z.string().regex(MONTH_RE),
    from: iso,
    to: iso,
    generatedAt: iso,
    operational: z.object({
      tasks: z.array(TaskCountsSchema),
      publishedArticles: z.array(PublishedArticleSchema),
      campaigns: z.array(ChannelCampaignSchema),
    }),
    objectives: z.array(ObjectiveProgressSchema),
    verified: z.array(VerifiedMetricsSchema),
    products: z.array(ReportProductSchema),
  })
  .openapi("EditorialReport");

export const MetricsRefreshReportSchema = z
  .object({
    provider: z.string(),
    considered: z.number().int(),
    written: z.number().int(),
    unchanged: z.number().int(),
    errors: z.array(z.object({ ref: z.string(), message: z.string() })),
  })
  .openapi("MetricsRefreshReport");

const ReportQuerySchema = z.object({
  month: z.string().regex(MONTH_RE, "YYYY-MM").optional().openapi({ example: "2026-11" }),
  productId: z.string().optional(),
});

const RefreshRequestSchema = z
  .object({ now: iso.optional().openapi({ description: "Simulated clock (mock metrics only, tests)" }) })
  .openapi("MetricsRefreshRequest");

const reportRoute = createRoute({
  method: "get",
  path: "/reports/editorial",
  tags: ["reporting"],
  summary: "Monthly editorial report: operational counts, contract objectives, verified measures",
  security,
  middleware: [authorize("report.read", (c) => ({ type: "report", productId: c.req.query("productId") ?? null }))] as const,
  request: { query: ReportQuerySchema },
  responses: {
    200: { description: "Report", content: { "application/json": { schema: EditorialReportSchema } } },
    400: problemResponse("Invalid month"),
    401: problemResponse("No valid session"),
    403: problemResponse("No role on the product"),
    404: problemResponse("Unknown product"),
  },
});

const refreshRoute = createRoute({
  method: "post",
  path: "/reports/metrics/refresh",
  tags: ["reporting"],
  summary: "Fetch fresh snapshots from the verified metrics provider (admin, audited, idempotent)",
  security,
  middleware: [authorize("metrics.refresh", () => ({ type: "report" }))] as const,
  request: { headers: idempotencyHeader, body: jsonBody(RefreshRequestSchema) },
  responses: {
    200: { description: "Refresh report", content: { "application/json": { schema: MetricsRefreshReportSchema } } },
    400: problemResponse("Simulated clock refused outside the mock provider"),
    401: problemResponse("No valid session"),
    403: problemResponse("Not an admin"),
    409: problemResponse("No verified metrics provider is connected"),
    422: problemResponse("Idempotency-Key reused for a different request"),
  },
});

export const reportRoutes = new OpenAPIHono<AppEnv>()
  .openapi(reportRoute, async (c) => {
    const q = c.req.valid("query");
    const db = c.var.db;
    const now = new Date();
    const scope = readableProducts(c.var.principal!);
    let productIds = scope;
    if (q.productId) {
      if (scope && !scope.includes(q.productId)) throw new ProblemError(403, "No role on this product");
      productIds = [q.productId];
    }
    const products = await db
      .select({ id: product.id, name: product.name, seoMonitorUrl: product.seoMonitorUrl })
      .from(product)
      .where(productIds ? inArray(product.id, productIds.length ? productIds : ["-"]) : undefined)
      .orderBy(asc(product.name));
    if (q.productId && !products.length) throw new ProblemError(404, "Unknown product");
    const month = q.month ?? monthOf(now);
    const report = await buildOperationalReport(db, { month, productIds, now });
    const verified = await verifiedSection(db, c.var.integrations.metrics, {
      productIds: products.map((p) => p.id),
      sentDeliveryIds: report.sentDeliveryIds,
      publishedTaskIds: report.publishedTaskIds,
    });
    return c.json(
      {
        month: report.month,
        from: report.from.toISOString(),
        to: report.to.toISOString(),
        generatedAt: now.toISOString(),
        operational: report.operational,
        objectives: report.objectives.map((o) => ({ ...o, objective: serialise(o.objective) })),
        verified,
        products,
      },
      200,
    );
  })
  .openapi(refreshRoute, async (c) => {
    const body = c.req.valid("json");
    const provider = c.var.integrations.metrics;
    if (!provider.verified) {
      throw new ProblemError(409, "Metrics provider not connected", {
        type: "https://trigenys.com/problems/metrics-not-connected",
        detail: notConnectedReason(provider),
      });
    }
    if (body.now && integrationModes(c.env).metrics !== "mock") {
      throw new ProblemError(400, "Simulated clock refused", { detail: "`now` is only accepted with the mock metrics provider" });
    }
    const principal = c.var.principal!;
    const result = await idempotent(c, body, async () => {
      const report = await audited(
        c.var.db,
        { actor: principal, action: "metrics.refresh", resource: { type: "report" }, requestId: c.var.requestId, details: { provider: provider.name } },
        async (tx) => refreshMetrics({ db: tx, provider, ...metricsTuning(c.env), now: body.now ? () => new Date(body.now!) : undefined }),
      );
      return { status: 200 as const, body: report };
    });
    return c.json(result.body, result.status);
  });
