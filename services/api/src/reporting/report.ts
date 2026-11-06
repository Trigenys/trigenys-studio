import { and, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { contractObjective, delivery, importItem, socialAccount, task, taskTransition, type ObjectiveMetric } from "../db/schema.ts";
import { monthRange } from "./period.ts";

// Operational counts: computed from Studio's own tables, always available,
// never a measure of audience. "done" is dated by the first transition to
// `published`, not by `updated_at`; "late" is a task due in the month whose
// due date passed without reaching published (rejected tasks are not late).
// Everything is UTC (ADR 0010).

export type TaskCounts = { productId: string; type: string; due: number; done: number; late: number };
export type PublishedArticle = { taskId: string; productId: string; title: string; publishedAt: string; url: string | null };
export type ChannelCampaign = {
  productId: string;
  channel: string;
  scheduled: number;
  handedOff: number;
  sent: number;
  failed: number;
  cancelled: number;
};
export type OperationalCounts = { tasks: TaskCounts[]; publishedArticles: PublishedArticle[]; campaigns: ChannelCampaign[] };

export type ObjectiveRow = typeof contractObjective.$inferSelect;
export type ObjectiveProgress = { objective: ObjectiveRow; actual: number; ratio: number };

export type OperationalReport = {
  month: string;
  from: Date;
  to: Date;
  operational: OperationalCounts;
  objectives: ObjectiveProgress[];
  // Ids the verified section joins on: what was published in the month.
  sentDeliveryIds: string[];
  publishedTaskIds: string[];
};

export type ReportScope = { month: string; productIds: string[] | null; now: Date };

const NOT_LATE = ["published", "measured", "rejected"] as const;

export const serialiseObjective = (o: ObjectiveRow) => ({ ...o, createdAt: o.createdAt.toISOString(), updatedAt: o.updatedAt.toISOString() });

// First `published` transition per task: the publication date of a task.
const firstPublished = (db: Db) =>
  db
    .select({ taskId: taskTransition.taskId, publishedAt: sql<Date>`min(${taskTransition.createdAt})`.as("published_at") })
    .from(taskTransition)
    .where(eq(taskTransition.toState, "published"))
    .groupBy(taskTransition.taskId)
    .as("first_published");

export async function buildOperationalReport(db: Db, scope: ReportScope): Promise<OperationalReport> {
  const { month, from, to } = monthRange(scope.month);
  const products = scope.productIds;
  const inScope = <T extends { productId: string }>(rows: T[]) => (products ? rows.filter((r) => products.includes(r.productId)) : rows);
  const productFilter = products ? inArray(task.productId, products.length ? products : ["-"]) : undefined;

  const dueRows = await db
    .select({ productId: task.productId, type: task.type, n: sql<number>`count(*)::int` })
    .from(task)
    .where(and(gte(task.dueAt, from), lt(task.dueAt, to), productFilter))
    .groupBy(task.productId, task.type);

  const lateRows = await db
    .select({ productId: task.productId, type: task.type, n: sql<number>`count(*)::int` })
    .from(task)
    .where(and(gte(task.dueAt, from), lt(task.dueAt, to), lt(task.dueAt, scope.now), sql`${task.state} not in ${NOT_LATE}`, productFilter))
    .groupBy(task.productId, task.type);

  const fp = firstPublished(db);
  const published = await db
    .select({ taskId: task.id, productId: task.productId, type: task.type, title: task.title, publishedAt: fp.publishedAt })
    .from(fp)
    .innerJoin(task, eq(task.id, fp.taskId))
    .where(and(gte(fp.publishedAt, from), lt(fp.publishedAt, to), productFilter))
    .orderBy(fp.publishedAt, task.title);

  const doneByKey = new Map<string, number>();
  for (const p of published) {
    const key = `${p.productId}\n${p.type}`;
    doneByKey.set(key, (doneByKey.get(key) ?? 0) + 1);
  }
  const keys = new Set<string>([...dueRows, ...lateRows].map((r) => `${r.productId}\n${r.type}`).concat([...doneByKey.keys()]));
  const tasks: TaskCounts[] = [...keys]
    .sort()
    .map((key) => {
      const [productId, type] = key.split("\n") as [string, string];
      return {
        productId,
        type,
        due: dueRows.find((r) => r.productId === productId && r.type === type)?.n ?? 0,
        done: doneByKey.get(key) ?? 0,
        late: lateRows.find((r) => r.productId === productId && r.type === type)?.n ?? 0,
      };
    });

  // Published articles with a URL: the linked CMS entry first, else the
  // permalink of a sent delivery.
  const articleIds = published.filter((p) => p.type === "article").map((p) => p.taskId);
  const urls = new Map<string, string>();
  if (articleIds.length) {
    const fromDeliveries = await db
      .select({ taskId: delivery.taskId, url: delivery.permalink })
      .from(delivery)
      .where(and(inArray(delivery.taskId, articleIds), eq(delivery.status, "sent"), isNotNull(delivery.permalink)));
    for (const d of fromDeliveries) if (d.url) urls.set(d.taskId, d.url);
    const fromImports = await db
      .select({ taskId: importItem.taskId, url: importItem.url })
      .from(importItem)
      .where(and(inArray(importItem.taskId, articleIds), isNotNull(importItem.url)));
    for (const i of fromImports) if (i.taskId && i.url) urls.set(i.taskId, i.url);
  }
  const publishedArticles: PublishedArticle[] = published
    .filter((p) => p.type === "article")
    .map((p) => ({ taskId: p.taskId, productId: p.productId, title: p.title, publishedAt: new Date(p.publishedAt).toISOString(), url: urls.get(p.taskId) ?? null }));

  // Campaigns per product and channel, dated by the send or the plan.
  const when = sql`coalesce(${delivery.sentAt}, ${delivery.scheduledAt})`;
  const count = (status: string) => sql<number>`count(*) filter (where ${delivery.status} = ${status})::int`;
  const campaignRows = await db
    .select({
      productId: socialAccount.productId,
      channel: socialAccount.channel,
      scheduled: count("scheduled"),
      handedOff: count("handed_off"),
      sent: count("sent"),
      failed: count("failed"),
      cancelled: count("cancelled"),
    })
    .from(delivery)
    .innerJoin(socialAccount, eq(socialAccount.id, delivery.socialAccountId))
    .where(and(gte(when, from), lt(when, to), products ? inArray(socialAccount.productId, products.length ? products : ["-"]) : undefined))
    .groupBy(socialAccount.productId, socialAccount.channel)
    .orderBy(socialAccount.productId, socialAccount.channel);
  const campaigns: ChannelCampaign[] = inScope(campaignRows);

  const sentDeliveryIds = (
    await db
      .select({ id: delivery.id })
      .from(delivery)
      .innerJoin(task, eq(task.id, delivery.taskId))
      .where(and(eq(delivery.status, "sent"), gte(delivery.sentAt, from), lt(delivery.sentAt, to), productFilter))
  ).map((r) => r.id);

  // Objectives: every active objective of the scope against the same aggregates.
  const objectiveRows = await db
    .select()
    .from(contractObjective)
    .where(and(eq(contractObjective.active, true), products ? inArray(contractObjective.productId, products.length ? products : ["-"]) : undefined))
    .orderBy(contractObjective.productId, contractObjective.metric, contractObjective.createdAt);
  const actualOf = (o: ObjectiveRow): number => {
    const metric: ObjectiveMetric = o.metric;
    if (metric === "tasks_completed") return tasks.filter((t) => t.productId === o.productId && (!o.taskType || t.type === o.taskType)).reduce((n, t) => n + t.done, 0);
    if (metric === "articles_published") return publishedArticles.filter((a) => a.productId === o.productId).length;
    return campaigns.filter((c) => c.productId === o.productId && (!o.channel || c.channel === o.channel)).reduce((n, c) => n + c.sent, 0);
  };
  const objectives: ObjectiveProgress[] = objectiveRows.map((o) => {
    const actual = actualOf(o);
    return { objective: o, actual, ratio: Math.round((actual / o.target) * 1000) / 1000 };
  });

  return {
    month,
    from,
    to,
    operational: { tasks, publishedArticles, campaigns },
    objectives,
    sentDeliveryIds,
    publishedTaskIds: published.map((p) => p.taskId),
  };
}
