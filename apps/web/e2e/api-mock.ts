import type { Page, Route } from "@playwright/test";
import type {
  Alert,
  NotificationPreference,
  AiInteraction,
  ContractObjective,
  EditorialReport,
  BrandKit,
  CalendarEntry,
  Comment,
  ContentVersion,
  Delivery,
  DeliveryAttempt,
  ImportItem,
  Me,
  Product,
  PublishReadiness,
  SocialAccount,
  Task,
  TaskDetail,
  TaskSource,
  TaskTransition,
  VisualAsset,
  VisualFormat,
} from "@trigenys/studio-contracts";

export const me: Me = {
  userId: "u-operator",
  email: "operatrice@example.com",
  name: "Opératrice",
  grants: [{ role: "operator", productId: "insight" }, { role: "reviewer", productId: null }],
};

export const products: Product[] = [
  { id: "insight", name: "Trigenys Insight", seoMonitorUrl: null, createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "precis", name: "Précis Translator", seoMonitorUrl: null, createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "atelier", name: "Atelier Maître", seoMonitorUrl: null, createdAt: "2026-01-01T00:00:00.000Z" },
];

const iso = (d: Date) => d.toISOString();
const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 15, 0);
const yesterday = new Date(today.getTime() - 24 * 3600_000);
const nextWeek = new Date(today.getTime() + 7 * 24 * 3600_000);

const base = {
  brief: "",
  priority: 0,
  assigneeId: null,
  version: 1,
  createdBy: "u-admin",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

export const tasks: Task[] = [
  { ...base, id: "11111111-1111-4111-8111-111111111111", productId: "insight", type: "post", title: "Lancement Insight sur LinkedIn", state: "preparing", dueAt: iso(today), assigneeId: "u-operator" },
  { ...base, id: "22222222-2222-4222-8222-222222222222", productId: "insight", type: "newsletter", title: "Édito de novembre", state: "awaiting_approval", dueAt: iso(nextWeek) },
  { ...base, id: "33333333-3333-4333-8333-333333333333", productId: "precis", type: "post", title: "Précis : étude de cas traduction", state: "scheduled", dueAt: iso(nextWeek) },
  { ...base, id: "44444444-4444-4444-8444-444444444444", productId: "atelier", type: "article", title: "Atelier Maître — rétrospective", state: "reviewing", dueAt: iso(yesterday) },
  { ...base, id: "55555555-5555-4555-8555-555555555555", productId: "insight", type: "post", title: "Thread sur la qualité des données", state: "qualifying", dueAt: null, assigneeId: "u-operator" },
];

// Alerts as the reconciler would derive them from the seeded tasks: one
// per task at most, one per refused delivery (ADR 0011).
const alertBase = { facts: {}, acknowledgedBy: null, acknowledgedAt: null, resolvedAt: null, resolution: null, emailStatus: "none" as const, version: 1 };
export const seedAlerts = (): Alert[] => [
  {
    ...alertBase,
    id: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
    kind: "task_blocked",
    priority: "p1",
    state: "open",
    productId: "atelier",
    taskId: "44444444-4444-4444-8444-444444444444",
    taskTitle: "Atelier Maître — rétrospective",
    taskState: "reviewing",
    deliveryId: null,
    title: "Tâche en retard : Atelier Maître — rétrospective",
    detail: `L'échéance du ${iso(yesterday).slice(0, 10)} est dépassée et la tâche est encore « reviewing ».`,
    firstSeenAt: iso(yesterday),
  },
  {
    ...alertBase,
    id: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
    kind: "approval_required",
    priority: "p2",
    state: "open",
    productId: "insight",
    taskId: "22222222-2222-4222-8222-222222222222",
    taskTitle: "Édito de novembre",
    taskState: "awaiting_approval",
    deliveryId: null,
    title: "Approbation requise : Édito de novembre",
    detail: "En attente d'approbation depuis le 2026-01-01 (plus de 24 h).",
    firstSeenAt: "2026-01-02T00:00:00.000Z",
    emailStatus: "sent",
  },
  {
    ...alertBase,
    id: "a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3",
    kind: "publication_failed",
    priority: "p1",
    state: "acknowledged",
    productId: "precis",
    taskId: "33333333-3333-4333-8333-333333333333",
    taskTitle: "Précis : étude de cas traduction",
    taskState: "scheduled",
    deliveryId: "d3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3",
    title: "Publication refusée : Précis : étude de cas traduction (linkedin)",
    detail: "Buffer a refusé la publication : jeton expiré.",
    firstSeenAt: "2026-01-03T00:00:00.000Z",
    acknowledgedBy: "u-admin",
    acknowledgedAt: "2026-01-03T01:00:00.000Z",
    emailStatus: "failed",
    version: 2,
  },
  {
    ...alertBase,
    id: "a4a4a4a4-a4a4-4a4a-8a4a-a4a4a4a4a4a4",
    kind: "content_fix",
    priority: "p3",
    state: "resolved",
    productId: "insight",
    taskId: "11111111-1111-4111-8111-111111111111",
    taskTitle: "Lancement Insight sur LinkedIn",
    taskState: "preparing",
    deliveryId: null,
    title: "Contenu à corriger : Lancement Insight sur LinkedIn",
    detail: "Le contenu a été renvoyé en correction ; il attend une nouvelle version.",
    firstSeenAt: "2026-01-04T00:00:00.000Z",
    resolvedAt: "2026-01-05T00:00:00.000Z",
    resolution: "La condition n'est plus remplie.",
    version: 2,
  },
];

const DEFAULT_EMAIL: Record<Alert["kind"], NotificationPreference["email"]> = {
  task_blocked: "off",
  content_fix: "off",
  approval_required: "immediate",
  publication_failed: "immediate",
};
const ALERT_KINDS = Object.keys(DEFAULT_EMAIL) as Alert["kind"][];

const FROZEN: Task["state"][] = ["scheduled", "published", "measured"];
// States from which a delivery can be planned: the approval covers the content.
const PUBLISHABLE: Task["state"][] = ["approved", "scheduled", "failed"];

// Social accounts an admin has mapped, one per product and channel.
const seedAccount = (id: string, productId: string, channel: SocialAccount["channel"], handle: string, displayName: string): SocialAccount => ({
  id,
  productId,
  channel,
  provider: "mock",
  externalRef: `ch-${productId}-${channel}`,
  handle,
  displayName,
  active: true,
  version: 1,
  createdBy: "u-admin",
  createdAt: "2026-01-05T00:00:00.000Z",
  updatedAt: "2026-01-05T00:00:00.000Z",
});
export const socialAccounts: SocialAccount[] = [
  seedAccount("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "insight", "linkedin", "@trigenys-insight", "Trigenys Insight"),
  seedAccount("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "precis", "linkedin", "@precis-translator", "Précis Translator"),
];
export const providerChannels = [
  { externalRef: "ch-insight-linkedin", service: "linkedin", name: "Trigenys Insight" },
  { externalRef: "ch-insight-x", service: "x", name: "Trigenys X" },
];

const seedVersion = (t: Task): ContentVersion | null =>
  t.state === "qualifying"
    ? null
    : {
        id: `v-${t.id.slice(0, 8)}`,
        taskId: t.id,
        n: 1,
        channel: "linkedin",
        body: "Insight est disponible.",
        contentHash: "abc",
        aiAssisted: false,
        authorId: "u-admin",
        createdAt: "2026-01-02T00:00:00.000Z",
      };

// What the Worker would allow for `me` (operator on insight, reviewer
// everywhere): enough for the pages to offer the right buttons.
const allowed = (t: Task, hasContent: boolean): Task["state"][] => {
  switch (t.state) {
    case "qualifying":
      return ["preparing"];
    case "preparing":
      return hasContent ? ["reviewing"] : [];
    case "reviewing":
      return t.productId === "insight" ? ["visuals", "needs_fix"] : ["needs_fix"];
    default:
      return [];
  }
};

export const detailOf = (t: Task, versions: ContentVersion[] = []): TaskDetail => {
  const latestVersion = versions.at(-1) ?? seedVersion(t);
  return {
    ...t,
    brief: t.brief || "Annoncer la disponibilité d'Insight aux équipes data.",
    latestVersion,
    latestApproval: PUBLISHABLE.includes(t.state)
      ? { id: `a-${t.id.slice(0, 8)}`, taskId: t.id, contentVersionId: latestVersion?.id ?? "", contentHash: "sha256:seed", assetSetHash: "sha256:none", approverId: "u-reviewer", decision: "approved" as const, comment: null, createdAt: "2026-01-03T00:00:00.000Z" }
      : null,
    approvalValid: PUBLISHABLE.includes(t.state),
    currentAssetSetHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    allowedTransitions: allowed(t, latestVersion !== null),
  };
};

type Options = {
  signedIn?: boolean;
  tasksStatus?: number;
  updateStatus?: number;
  reviewerOnly?: boolean;
  admin?: boolean;
  approvedKit?: boolean;
  publishable?: boolean;
  /** A verified metrics provider is connected (SEO Monitor contract). */
  metricsConnected?: boolean;
};

// Visual formats as seeded by the Worker, and a tiny SVG standing for any
// logo or rendered visual: the UI only needs a displayable image.
const LAYOUT = { padding: 64, titleSize: 64, subtitleSize: 32, logoHeight: 72, logoPosition: "top-left" as const, titleMaxLines: 3 };
export const visualFormats: VisualFormat[] = [
  { id: "article", label: "Article (OG)", width: 1200, height: 630, channel: "article", layout: LAYOUT, active: true, updatedAt: "2026-01-01T00:00:00.000Z" },
  { id: "linkedin", label: "LinkedIn", width: 1200, height: 627, channel: "linkedin", layout: LAYOUT, active: true, updatedAt: "2026-01-01T00:00:00.000Z" },
  { id: "instagram", label: "Instagram", width: 1080, height: 1080, channel: "instagram", layout: LAYOUT, active: true, updatedAt: "2026-01-01T00:00:00.000Z" },
];
export const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="63" viewBox="0 0 120 63"><rect width="120" height="63" fill="#1d4ed8"/></svg>';
const HASH = "0".repeat(64);
export const seedKit = (productId: string, status: BrandKit["status"], n = 1): BrandKit => ({
  id: crypto.randomUUID(),
  productId,
  n,
  name: `Kit ${productId} ${n}`,
  status,
  palette: { primary: "#1d4ed8", secondary: "#0f172a", background: "#ffffff", text: "#111827" },
  fontFamily: "Inter, Arial, sans-serif",
  defaultTitle: null,
  mentions: "© Trigenys",
  logoMime: "image/svg+xml",
  logoHash: HASH,
  logoBytes: SVG.length,
  kitHash: HASH,
  createdBy: "u-admin",
  createdAt: "2026-02-01T00:00:00.000Z",
  approvedBy: status === "draft" ? null : "u-admin",
  approvedAt: status === "draft" ? null : "2026-02-02T00:00:00.000Z",
  retiredAt: null,
});

// What a sync brings in: one CMS article and one radar topic, as received.
export const incomingImports: Omit<ImportItem, "id" | "status" | "taskId" | "decidedBy" | "decidedAt" | "firstSeenAt" | "syncedAt">[] = [
  {
    origin: "cms",
    externalRef: "12:fr",
    title: "Neon vs Supabase",
    url: "https://insight.example/fr/posts/neon-vs-supabase",
    summary: "Comparatif des offres gratuites.",
    sources: ["https://insight.example/fr/posts/neon-vs-supabase"],
    payload: { locale: "fr", status: "published" },
    observedAt: "2026-03-01T08:00:00.000Z",
  },
  {
    origin: "radar",
    externalRef: "run-1",
    title: "Les LLM en PME",
    url: null,
    summary: "Coût réel d'un assistant interne. Format proposé : analysis",
    sources: ["https://source.example/llm"],
    payload: { angle: "Coût réel", format: "analysis", vertical: "insight", score: 81.5 },
    observedAt: "2026-02-01T00:00:00.000Z",
  },
];

const problem = (status: number, title: string) => ({ type: "about:blank", title, status });

// Intercepts every API call the app makes with an in-memory store per page,
// mirroring the Worker's rules the UI relies on: product filtering, frozen
// content, optimistic version on updates, transitions recorded in history.
export async function mockApi(
  page: Page,
  { signedIn = true, tasksStatus = 200, updateStatus = 200, reviewerOnly = false, admin = false, approvedKit = true, publishable = false, metricsConnected = false }: Options = {},
) {
  const whoami: Me = reviewerOnly
    ? { ...me, grants: [{ role: "reviewer", productId: null }] }
    : admin
      ? { ...me, userId: "u-admin", name: "Admin", grants: [{ role: "admin", productId: null }] }
      : me;
  const store = {
    tasks: tasks.map((t, i) => ({ ...t, state: publishable && i === 0 ? ("approved" as const) : t.state })),
    accounts: socialAccounts.map((a) => ({ ...a })),
    deliveries: [] as Delivery[],
    attempts: new Map<string, DeliveryAttempt[]>(),
    kits: approvedKit ? [seedKit("insight", "approved")] : ([] as BrandKit[]),
    visuals: new Map<string, VisualAsset[]>(),
    imports: [] as ImportItem[],
    versions: new Map<string, ContentVersion[]>(),
    comments: new Map<string, Comment[]>(),
    history: new Map<string, TaskTransition[]>(),
    sources: new Map<string, TaskSource[]>(),
    interactions: new Map<string, AiInteraction[]>(),
    products: products.map((p) => ({ ...p })),
    objectives: [] as ContractObjective[],
    alerts: seedAlerts(),
    preferences: [] as NotificationPreference[],
  };
  const find = (id: string | undefined) => store.tasks.find((x) => x.id === id);
  const detail = (t: Task) => detailOf(t, store.versions.get(t.id));
  const stamp = () => new Date().toISOString();
  const uuid = () => crypto.randomUUID();

  const json = (route: Route, status: number, body: unknown) =>
    route.request().resourceType() === "document"
      ? route.continue() // a page navigation such as /tasks/<id>: let Vite serve the SPA
      : route.fulfill({ status, contentType: status >= 400 ? "application/problem+json" : "application/json", body: JSON.stringify(body) });

  await page.route("**/me", (route) => (signedIn ? json(route, 200, whoami) : json(route, 401, problem(401, "No valid session"))));

  await page.route("**/alerts/reconcile", (route) =>
    admin
      ? json(route, 200, { reconcile: { opened: 0, updated: 0, escalated: 0, resolved: 0, queued: 0 }, notify: { claimed: 0, sent: 0, retried: 0, failed: 0, skipped: 0 } })
      : json(route, 403, problem(403, "Forbidden")),
  );
  await page.route(/\/alerts\/[0-9a-f-]{36}\/acknowledge$/, (route) => {
    const id = route.request().url().match(/\/alerts\/([0-9a-f-]{36})\/acknowledge$/)![1];
    const a = store.alerts.find((x) => x.id === id);
    if (!a) return json(route, 404, problem(404, "Alert not found"));
    if (a.state === "resolved") return json(route, 409, problem(409, "Alert already resolved"));
    if (a.state === "open") Object.assign(a, { state: "acknowledged", acknowledgedBy: whoami.userId, acknowledgedAt: stamp(), version: a.version + 1 });
    return json(route, 200, a);
  });
  await page.route(/\/alerts(\?.*)?$/, (route) => {
    const q = new URL(route.request().url()).searchParams;
    const state = q.get("state") ?? "active";
    const list = store.alerts.filter(
      (a) =>
        (state === "active" ? a.state !== "resolved" : a.state === state) &&
        (!q.get("priority") || a.priority === q.get("priority")) &&
        (!q.get("productId") || a.productId === q.get("productId")),
    );
    return json(route, 200, list);
  });
  await page.route("**/me/notification-preferences", (route) => {
    if (!signedIn) return json(route, 401, problem(401, "No valid session"));
    const current = () => ALERT_KINDS.map((kind) => store.preferences.find((p) => p.kind === kind) ?? { kind, email: DEFAULT_EMAIL[kind], source: "default" as const });
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as { preferences: { kind: Alert["kind"]; email: NotificationPreference["email"] }[] };
      for (const p of body.preferences) {
        const existing = store.preferences.find((x) => x.kind === p.kind);
        if (existing) existing.email = p.email;
        else store.preferences.push({ kind: p.kind, email: p.email, source: "user" });
      }
    }
    return json(route, 200, current());
  });

  await page.route(/\/imports(\?.*)?$/, (route) => {
    const q = new URL(route.request().url()).searchParams;
    return json(
      route,
      200,
      store.imports.filter((i) => (!q.get("origin") || i.origin === q.get("origin")) && (!q.get("status") || i.status === q.get("status"))),
    );
  });
  await page.route("**/imports/sync", (route) => {
    let created = 0;
    for (const inc of incomingImports) {
      if (store.imports.some((i) => i.origin === inc.origin && i.externalRef === inc.externalRef)) continue;
      store.imports.push({ ...inc, id: uuid(), status: "new", taskId: null, decidedBy: null, decidedAt: null, firstSeenAt: stamp(), syncedAt: stamp() });
      created += 1;
    }
    return json(route, 200, {
      origins: (["cms", "radar"] as const).map((origin) => ({ origin, fetched: 1, created: created ? 1 : 0, updated: created ? 0 : 1 })),
    });
  });
  await page.route(/\/imports\/[0-9a-f-]{36}\/(task|ignore)$/, (route) => {
    const [, id, action] = route.request().url().match(/\/imports\/([0-9a-f-]{36})\/(task|ignore)$/)!;
    const item = store.imports.find((i) => i.id === id)!;
    if (item.status !== "new") return json(route, 409, problem(409, `Item already ${item.status}`));
    if (action === "task") {
      const body = route.request().postDataJSON() as { productId: string; type?: string };
      const t: Task = {
        id: uuid(),
        productId: body.productId,
        type: body.type ?? "post",
        title: item.title,
        brief: item.summary,
        state: "qualifying",
        priority: 0,
        dueAt: null,
        assigneeId: me.userId,
        createdBy: me.userId,
        version: 1,
        createdAt: stamp(),
        updatedAt: stamp(),
      };
      store.tasks.push(t);
      Object.assign(item, { status: "linked", taskId: t.id, decidedBy: me.userId, decidedAt: stamp() });
      return json(route, 201, item);
    }
    Object.assign(item, { status: "ignored", decidedBy: me.userId, decidedAt: stamp() });
    return json(route, 200, item);
  });
  await page.route("**/products", (route) => json(route, 200, store.products));

  await page.route("**/tasks?**", (route) => {
    if (tasksStatus !== 200) return json(route, tasksStatus, problem(tasksStatus, "Service indisponible"));
    const productId = new URL(route.request().url()).searchParams.get("productId");
    return json(route, 200, productId ? store.tasks.filter((t) => t.productId === productId) : store.tasks);
  });
  await page.route("**/tasks", (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Partial<Task>;
      const t: Task = {
        ...base,
        id: uuid(),
        productId: body.productId!,
        type: body.type!,
        title: body.title!,
        brief: body.brief ?? "",
        priority: body.priority ?? 0,
        dueAt: body.dueAt ?? null,
        assigneeId: body.assigneeId ?? null,
        state: "qualifying",
        createdBy: me.userId,
        createdAt: stamp(),
        updatedAt: stamp(),
      };
      store.tasks.push(t);
      return json(route, 201, detail(t));
    }
    return tasksStatus === 200 ? json(route, 200, store.tasks) : json(route, tasksStatus, problem(tasksStatus, "Service indisponible"));
  });

  await page.route(/\/tasks\/[0-9a-f-]{36}$/, (route) => {
    const t = find(route.request().url().split("/").pop());
    if (!t) return json(route, 404, problem(404, "Not found"));
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as { version: number } & Partial<Task>;
      if (updateStatus !== 200 || body.version !== t.version) return json(route, 409, problem(409, "Version obsolète"));
      Object.assign(t, body, { version: t.version + 1, updatedAt: stamp() });
      return json(route, 200, detail(t));
    }
    return json(route, 200, detail(t));
  });

  await page.route(/\/tasks\/[0-9a-f-]{36}\/versions$/, (route) => {
    const [, id] = route.request().url().match(/\/tasks\/([0-9a-f-]{36})\//)!;
    const t = find(id)!;
    const list = store.versions.get(t.id) ?? (seedVersion(t) ? [seedVersion(t)!] : []);
    if (route.request().method() === "POST") {
      if (FROZEN.includes(t.state)) return json(route, 409, problem(409, "Contenu gelé"));
      const body = route.request().postDataJSON() as { channel: string; body: string; aiAssisted?: boolean };
      const v: ContentVersion = {
        id: uuid(),
        taskId: t.id,
        n: list.length + 1,
        channel: body.channel,
        body: body.body,
        contentHash: `h${list.length + 1}`,
        aiAssisted: body.aiAssisted ?? false,
        authorId: me.userId,
        createdAt: stamp(),
      };
      store.versions.set(t.id, [...list, v]);
      if (t.state === "awaiting_approval" || t.state === "approved") t.state = "preparing";
      return json(route, 201, v);
    }
    return json(route, 200, list);
  });

  await page.route(/\/tasks\/[0-9a-f-]{36}\/comments$/, (route) => {
    const [, id] = route.request().url().match(/\/tasks\/([0-9a-f-]{36})\//)!;
    const list = store.comments.get(id) ?? [];
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { body: string };
      const c: Comment = { id: uuid(), taskId: id, authorId: me.userId, body: body.body, createdAt: stamp() };
      store.comments.set(id, [...list, c]);
      return json(route, 201, c);
    }
    return json(route, 200, list);
  });

  await page.route(/\/tasks\/[0-9a-f-]{36}\/sources$/, (route) => {
    const [, id] = route.request().url().match(/\/tasks\/([0-9a-f-]{36})\//)!;
    const list = store.sources.get(id) ?? [];
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { title: string; url?: string | null; note?: string };
      const s: TaskSource = { id: uuid(), taskId: id, origin: "manual", title: body.title, url: body.url ?? null, note: body.note ?? "", addedBy: me.userId, createdAt: stamp() };
      store.sources.set(id, [...list, s]);
      return json(route, 201, s);
    }
    return json(route, 200, list);
  });
  await page.route(/\/tasks\/[0-9a-f-]{36}\/sources\/[0-9a-f-]{36}$/, (route) => {
    const [, id, sourceId] = route.request().url().match(/\/tasks\/([0-9a-f-]{36})\/sources\/([0-9a-f-]{36})$/)!;
    store.sources.set(id, (store.sources.get(id) ?? []).filter((s) => s.id !== sourceId));
    return route.fulfill({ status: 204 });
  });

  // The assistant mirrors the Worker's mock model: the output names the
  // action, a proposal is inert until accepted, accepting adds a version.
  await page.route(/\/tasks\/[0-9a-f-]{36}\/assistant$/, (route) => {
    const [, id] = route.request().url().match(/\/tasks\/([0-9a-f-]{36})\//)!;
    const t = find(id)!;
    const list = store.interactions.get(id) ?? [];
    if (route.request().method() === "POST") {
      if (FROZEN.includes(t.state)) return json(route, 409, problem(409, "Contenu gelé"));
      const body = route.request().postDataJSON() as { action: AiInteraction["action"]; channel: string; instruction?: string };
      const latest = detail(t).latestVersion;
      const i: AiInteraction = {
        id: uuid(),
        taskId: id,
        action: body.action,
        channel: body.channel,
        instruction: body.instruction ?? "",
        model: "mock",
        actorId: me.userId,
        contextRefs: [`task:${id}`, ...(latest ? [`version:${latest.id}`] : [])],
        inputHash: "0".repeat(64),
        output: body.action === "propose" ? "Insight est disponible.\nEssayez-le dès aujourd'hui." : `${latest?.body ?? ""}\nEn savoir plus sur trigenys.com.`,
        tokensIn: 10,
        tokensOut: 5,
        status: "proposed",
        acceptedVersionId: null,
        createdAt: stamp(),
      };
      store.interactions.set(id, [i, ...list]);
      return json(route, 201, i);
    }
    return json(route, 200, list);
  });
  await page.route(/\/tasks\/[0-9a-f-]{36}\/assistant\/[0-9a-f-]{36}\/(accept|dismiss)$/, (route) => {
    const [, id, interactionId, verb] = route.request().url().match(/\/tasks\/([0-9a-f-]{36})\/assistant\/([0-9a-f-]{36})\/(accept|dismiss)$/)!;
    const t = find(id)!;
    const i = (store.interactions.get(id) ?? []).find((x) => x.id === interactionId)!;
    if (i.status !== "proposed" || (verb === "accept" && FROZEN.includes(t.state))) return json(route, 409, problem(409, "Proposition déjà décidée"));
    if (verb === "dismiss") {
      i.status = "dismissed";
      return json(route, 200, i);
    }
    const list = store.versions.get(t.id) ?? (seedVersion(t) ? [seedVersion(t)!] : []);
    const v: ContentVersion = { id: uuid(), taskId: t.id, n: list.length + 1, channel: i.channel, body: i.output, contentHash: `h${list.length + 1}`, aiAssisted: true, authorId: me.userId, createdAt: stamp() };
    store.versions.set(t.id, [...list, v]);
    if (t.state === "awaiting_approval" || t.state === "approved") t.state = "preparing";
    i.status = "accepted";
    i.acceptedVersionId = v.id;
    return json(route, 201, v);
  });

  await page.route(/\/tasks\/[0-9a-f-]{36}\/(transitions|approvals)$/, (route) => {
    const [, id, kind] = route.request().url().match(/\/tasks\/([0-9a-f-]{36})\/(transitions|approvals)$/)!;
    const t = find(id)!;
    if (route.request().method() === "GET") return json(route, 200, kind === "transitions" ? (store.history.get(id) ?? []) : []);
    const body = route.request().postDataJSON() as { to?: Task["state"]; reason?: string | null; decision?: "approved" | "rejected" };
    const to: Task["state"] = body.to ?? (body.decision === "approved" ? "approved" : "rejected");
    store.history.set(id, [
      ...(store.history.get(id) ?? []),
      { id: uuid(), taskId: id, fromState: t.state, toState: to, actorId: me.userId, reason: body.reason ?? null, createdAt: stamp() },
    ]);
    t.state = to;
    return json(route, body.to ? 200 : 201, { ...detail(t), allowedTransitions: [] });
  });

  const svg = (route: Route) =>
    route.fulfill({ status: 200, contentType: "image/svg+xml", headers: { "cache-control": "private, max-age=31536000, immutable" }, body: SVG });
  const approvedKitOf = (productId: string) => store.kits.find((k) => k.productId === productId && k.status === "approved");
  const isWriter = () => whoami.grants.some((g) => g.role === "admin" || g.role === "operator");

  await page.route("**/visual-formats", (route) => json(route, 200, visualFormats));
  await page.route(/\/products\/[a-z0-9-]+\/brand-kits$/, (route) => {
    const productId = route.request().url().match(/\/products\/([a-z0-9-]+)\/brand-kits$/)![1]!;
    const mine = store.kits.filter((k) => k.productId === productId);
    if (route.request().method() === "GET") return json(route, 200, [...mine].sort((a, b) => b.n - a.n));
    if (!whoami.grants.some((g) => g.role === "admin")) return json(route, 403, problem(403, "Forbidden"));
    const body = route.request().postDataJSON() as Pick<BrandKit, "name" | "palette" | "fontFamily" | "mentions"> & { logo: { mime: BrandKit["logoMime"] } };
    const kit: BrandKit = { ...seedKit(productId, "draft", mine.length + 1), name: body.name, palette: body.palette, fontFamily: body.fontFamily, mentions: body.mentions, logoMime: body.logo.mime, createdAt: stamp() };
    store.kits.push(kit);
    return json(route, 201, kit);
  });
  await page.route(/\/brand-kits\/[0-9a-f-]{36}\/approve$/, (route) => {
    const id = route.request().url().match(/\/brand-kits\/([0-9a-f-]{36})\/approve$/)![1]!;
    const kit = store.kits.find((k) => k.id === id)!;
    if (kit.status === "retired") return json(route, 409, problem(409, "Brand kit retired"));
    for (const other of store.kits) {
      if (other.productId === kit.productId && other.status === "approved" && other.id !== kit.id) Object.assign(other, { status: "retired", retiredAt: stamp() });
    }
    Object.assign(kit, { status: "approved", approvedBy: whoami.userId, approvedAt: stamp() });
    return json(route, 200, kit);
  });
  await page.route(/\/brand-kits\/[0-9a-f-]{36}\/logo$/, svg);
  await page.route(/\/visuals\/[0-9a-f-]{36}\/file$/, svg);

  await page.route(/\/tasks\/[0-9a-f-]{36}\/visuals$/, (route) => {
    const id = route.request().url().match(/\/tasks\/([0-9a-f-]{36})\/visuals$/)![1]!;
    const t = find(id)!;
    const all = store.visuals.get(id) ?? [];
    if (route.request().method() === "GET") return json(route, 200, all.filter((v) => v.status === "active"));
    if (!isWriter()) return json(route, 403, problem(403, "Forbidden"));
    if (FROZEN.includes(t.state)) return json(route, 409, problem(409, "Task content is frozen"));
    const kit = approvedKitOf(t.productId);
    if (!kit) return json(route, 409, problem(409, "No approved brand kit for this product"));
    const body = route.request().postDataJSON() as { formatId: string; subtitle: string };
    const format = visualFormats.find((f) => f.id === body.formatId);
    if (!format) return json(route, 422, problem(422, "Unknown visual format"));
    const visual: VisualAsset = {
      id: uuid(),
      taskId: id,
      formatId: format.id,
      brandKitId: kit.id,
      brandKitHash: kit.kitHash,
      contentVersionId: null,
      title: t.title,
      subtitle: body.subtitle,
      brief: "",
      variant: all.filter((v) => v.formatId === format.id).length + 1,
      renderer: "svg@1",
      mime: "image/svg+xml",
      width: format.width,
      height: format.height,
      contentHash: HASH,
      byteSize: SVG.length,
      status: "active",
      createdBy: whoami.userId,
      createdAt: stamp(),
      discardedBy: null,
      discardedAt: null,
    };
    store.visuals.set(id, [...all, visual]);
    if (t.state === "awaiting_approval" || t.state === "approved") t.state = "preparing"; // the approval no longer covers the assets
    return json(route, 201, visual);
  });
  await page.route(/\/tasks\/[0-9a-f-]{36}\/visuals\/[0-9a-f-]{36}$/, (route) => {
    const [, id, visualId] = route.request().url().match(/\/tasks\/([0-9a-f-]{36})\/visuals\/([0-9a-f-]{36})$/)!;
    const t = find(id)!;
    if (!isWriter()) return json(route, 403, problem(403, "Forbidden"));
    if (FROZEN.includes(t.state)) return json(route, 409, problem(409, "Task content is frozen"));
    const visual = (store.visuals.get(id!) ?? []).find((v) => v.id === visualId)!;
    Object.assign(visual, { status: "discarded", discardedBy: whoami.userId, discardedAt: stamp() });
    return json(route, 200, visual);
  });

  // Publishing: accounts, deliveries and the calendar, with the Worker's
  // readiness rules and task moves (approved <-> scheduled <-> failed).
  const delivered = (t: Task) => store.deliveries.filter((d) => d.taskId === t.id);
  const liveOf = (t: Task) => delivered(t).filter((d) => ["draft", "scheduled", "sending", "handed_off"].includes(d.status));
  const settle = (t: Task) => {
    const all = delivered(t).filter((d) => d.status !== "cancelled");
    if (t.state === "scheduled" && liveOf(t).length === 0 && !all.some((d) => d.status === "sent")) t.state = "approved";
    if (t.state === "failed" && !all.some((d) => d.status === "failed")) t.state = "approved";
  };
  const readiness = (t: Task, account: SocialAccount | undefined, scheduledAt: string | null): PublishReadiness => {
    const latest = detail(t).latestVersion;
    const check = (ok: boolean, reason: string) => ({ ok, reason: ok ? "ok" : reason });
    const horizon = new Date(now.getTime() + 90 * 24 * 3600_000);
    const when = scheduledAt ? new Date(scheduledAt) : null;
    const checks = {
      state: check(PUBLISHABLE.includes(t.state), `La tâche est « ${t.state} », pas approuvée`),
      approval: check(PUBLISHABLE.includes(t.state), "Aucune approbation valable pour cette version"),
      account: check(
        !!account && account.active && account.productId === t.productId && account.channel === latest?.channel,
        account ? `Le compte vise ${account.channel}, la version vise ${latest?.channel ?? "aucun canal"}` : "Compte inconnu",
      ),
      permission: check(isWriter(), "Votre rôle ne publie pas"),
      window: check(when === null || (when > now && when <= horizon), "Date hors fenêtre : entre maintenant et 90 jours"),
    };
    return { ready: Object.values(checks).every((c) => c.ok), checks };
  };
  // Seeded: the scheduled task of Précis has its delivery planned next week at 18:00.
  if (store.deliveries.length === 0) {
    const t = store.tasks[2]!;
    store.deliveries.push({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      taskId: t.id,
      socialAccountId: socialAccounts[1]!.id,
      contentVersionId: `v-${t.id.slice(0, 8)}`,
      approvalId: `a-${t.id.slice(0, 8)}`,
      scheduledAt: new Date(nextWeek.getTime() + 3 * 3600_000).toISOString(),
      status: "scheduled",
      externalId: null,
      permalink: null,
      attempts: 0,
      maxAttempts: 5,
      lastError: null,
      nextRetryAt: null,
      sentAt: null,
      version: 1,
      createdBy: "u-operator",
      createdAt: "2026-01-06T00:00:00.000Z",
      updatedAt: "2026-01-06T00:00:00.000Z",
      account: socialAccounts[1]!,
    });
  }

  await page.route(/\/social-accounts(\?.*)?$/, (route) => {
    if (route.request().method() === "POST") {
      if (!whoami.grants.some((g) => g.role === "admin")) return json(route, 403, problem(403, "Admins only"));
      const body = route.request().postDataJSON() as Omit<SocialAccount, "id" | "active" | "version" | "createdBy" | "createdAt" | "updatedAt">;
      const existing = store.accounts.find((a) => a.productId === body.productId && a.provider === body.provider && a.externalRef === body.externalRef);
      if (existing) return json(route, 409, problem(409, `Channel ${body.externalRef} is already mapped as ${existing.handle}`));
      const a: SocialAccount = { ...body, id: uuid(), active: true, version: 1, createdBy: whoami.userId, createdAt: stamp(), updatedAt: stamp() };
      store.accounts.push(a);
      return json(route, 201, a);
    }
    const q = new URL(route.request().url()).searchParams;
    return json(
      route,
      200,
      store.accounts.filter((a) => (!q.get("productId") || a.productId === q.get("productId")) && (!q.get("channel") || a.channel === q.get("channel"))),
    );
  });
  await page.route("**/social-accounts/provider-channels", (route) => json(route, 200, providerChannels));
  await page.route(/\/social-accounts\/[0-9a-f-]{36}$/, (route) => {
    const a = store.accounts.find((x) => x.id === route.request().url().split("/").pop());
    if (!a) return json(route, 404, problem(404, "Unknown account"));
    const body = route.request().postDataJSON() as { active?: boolean; handle?: string; displayName?: string; version: number };
    if (body.version !== a.version) return json(route, 409, problem(409, "Version conflict"));
    Object.assign(a, { active: body.active ?? a.active, handle: body.handle ?? a.handle, displayName: body.displayName ?? a.displayName, version: a.version + 1, updatedAt: stamp() });
    return json(route, 200, a);
  });

  await page.route(/\/tasks\/[0-9a-f-]{36}\/publish-readiness(\?.*)?$/, (route) => {
    const url = new URL(route.request().url());
    const t = find(url.pathname.split("/").at(-2));
    if (!t) return json(route, 404, problem(404, "Not found"));
    const account = store.accounts.find((a) => a.id === url.searchParams.get("socialAccountId"));
    return json(route, 200, readiness(t, account, url.searchParams.get("scheduledAt")));
  });
  await page.route(/\/tasks\/[0-9a-f-]{36}\/deliveries$/, (route) => {
    const t = find(route.request().url().split("/").at(-2));
    if (!t) return json(route, 404, problem(404, "Not found"));
    if (route.request().method() === "POST") {
      if (!isWriter() || !PUBLISHABLE.includes(t.state)) return json(route, 403, problem(403, "Forbidden"));
      const body = route.request().postDataJSON() as { socialAccountId: string; scheduledAt?: string | null };
      const account = store.accounts.find((a) => a.id === body.socialAccountId);
      const r = readiness(t, account, body.scheduledAt ?? null);
      if (!r.ready || !account) return json(route, 422, problem(422, "Not ready to publish"));
      const d: Delivery = {
        id: uuid(),
        taskId: t.id,
        socialAccountId: account.id,
        contentVersionId: detail(t).latestVersion?.id ?? "",
        approvalId: `a-${t.id.slice(0, 8)}`,
        scheduledAt: body.scheduledAt ?? null,
        status: body.scheduledAt ? "scheduled" : "draft",
        externalId: null,
        permalink: null,
        attempts: 0,
        maxAttempts: 5,
        lastError: null,
        nextRetryAt: null,
        sentAt: null,
        version: 1,
        createdBy: whoami.userId,
        createdAt: stamp(),
        updatedAt: stamp(),
        account,
      };
      store.deliveries.push(d);
      if (d.status === "scheduled") t.state = "scheduled";
      return json(route, 201, d);
    }
    return json(route, 200, delivered(t));
  });
  await page.route(/\/deliveries\/[0-9a-f-]{36}\/(schedule|cancel|retry|permalink|attempts)$/, (route) => {
    const [, id, action] = route.request().url().match(/\/deliveries\/([0-9a-f-]{36})\/(\w+)$/)!;
    const d = store.deliveries.find((x) => x.id === id);
    if (!d) return json(route, 404, problem(404, "Not found"));
    if (action === "attempts") return json(route, 200, store.attempts.get(d.id) ?? []);
    const t = find(d.taskId)!;
    const body = route.request().postDataJSON() as { version: number; scheduledAt?: string; url?: string };
    if (body.version !== d.version) return json(route, 409, problem(409, "Version conflict"));
    if (action === "schedule") {
      if (!["draft", "scheduled"].includes(d.status)) return json(route, 409, problem(409, `Delivery is ${d.status}`));
      if (!readiness(t, d.account, body.scheduledAt!).ready) return json(route, 422, problem(422, "Not ready to publish"));
      Object.assign(d, { scheduledAt: body.scheduledAt, status: "scheduled" });
      t.state = "scheduled";
    } else if (action === "cancel") {
      if (["sending", "sent", "cancelled"].includes(d.status)) return json(route, 409, problem(409, `Delivery is ${d.status}`));
      d.status = "cancelled";
      settle(t);
    } else if (action === "retry") {
      if (d.status !== "failed") return json(route, 409, problem(409, `Delivery is ${d.status}`));
      Object.assign(d, { status: "scheduled", maxAttempts: d.attempts + 3, nextRetryAt: null });
      t.state = "scheduled";
    } else {
      if (!["sent", "handed_off"].includes(d.status)) return json(route, 409, problem(409, `Delivery is ${d.status}`));
      if (!/^https:\/\/(www\.)?(linkedin\.com|x\.com|instagram\.com)\//.test(body.url ?? "")) return json(route, 422, problem(422, "Unexpected host"));
      d.permalink = body.url!;
    }
    Object.assign(d, { version: d.version + 1, updatedAt: stamp() });
    return json(route, 200, d);
  });
  await page.route(/\/calendar\?.*$/, (route) => {
    const q = new URL(route.request().url()).searchParams;
    const from = new Date(q.get("from")!);
    const to = new Date(q.get("to")!);
    const productId = q.get("productId");
    const inWindow = (iso: string) => new Date(iso) >= from && new Date(iso) < to;
    const entries: CalendarEntry[] = store.deliveries
      .filter((d) => d.scheduledAt && d.status !== "cancelled" && inWindow(d.scheduledAt) && (!productId || find(d.taskId)!.productId === productId))
      .map((d) => {
        const t = find(d.taskId)!;
        return {
          id: d.id,
          taskId: t.id,
          taskTitle: t.title,
          productId: t.productId,
          channel: d.account!.channel,
          accountHandle: d.account!.handle,
          scheduledAt: d.scheduledAt!,
          status: d.status,
          lastError: d.lastError,
          permalink: d.permalink,
        };
      });
    const dueTasks = store.tasks
      .filter((t) => t.dueAt && inWindow(t.dueAt) && (!productId || t.productId === productId))
      .map((t) => ({ id: t.id, title: t.title, productId: t.productId, state: t.state, dueAt: t.dueAt! }));
    return json(route, 200, { from: from.toISOString(), to: to.toISOString(), deliveries: entries, dueTasks });
  });

  // Test hook: mark a delivery failed so the retry path can be exercised.
  await page.route("**/__test/fail-delivery", (route) => {
    const d = store.deliveries.find((x) => x.taskId === store.tasks[0]!.id);
    if (d) {
      Object.assign(d, { status: "failed", attempts: 2, lastError: "Provider refused the post", version: d.version + 1 });
      store.attempts.set(d.id, [
        { id: uuid(), deliveryId: d.id, n: 1, trigger: "cron", startedAt: stamp(), finishedAt: stamp(), outcome: "retryable_error", externalId: null, error: "timeout", retryAfterS: 60 },
        { id: uuid(), deliveryId: d.id, n: 2, trigger: "retry", startedAt: stamp(), finishedAt: stamp(), outcome: "fatal_error", externalId: null, error: "Provider refused the post", retryAfterS: null },
      ]);
      store.tasks[0]!.state = "failed";
    }
    return json(route, 204, null);
  });


  // ---- Reporting (ADR 0010) ------------------------------------------
  // Operational counts come from the store; verified measures only exist when
  // a provider is connected, otherwise the section carries no figure at all.
  const isAdmin = () => whoami.grants.some((g) => g.role === "admin");
  const DONE: Task["state"][] = ["published", "measured"];
  await page.route("**/reports/editorial**", (route) => {
    const url = new URL(route.request().url());
    const month = url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
    const productId = url.searchParams.get("productId");
    if (productId && !store.products.some((p) => p.id === productId)) return json(route, 404, problem(404, "Unknown product"));
    const scoped = store.products.filter((p) => !productId || p.id === productId);
    const from = new Date(`${month}-01T00:00:00Z`);
    const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
    const inMonth = (iso: string | null) => iso !== null && new Date(iso) >= from && new Date(iso) < to;
    const counts = new Map<string, EditorialReport["operational"]["tasks"][number]>();
    for (const t of store.tasks.filter((t) => scoped.some((p) => p.id === t.productId))) {
      const key = `${t.productId}/${t.type}`;
      const row = counts.get(key) ?? { productId: t.productId, type: t.type, due: 0, done: 0, late: 0 };
      if (inMonth(t.dueAt)) {
        row.due += 1;
        if (new Date(t.dueAt!) < new Date() && !DONE.includes(t.state) && t.state !== "rejected") row.late += 1;
      }
      if (DONE.includes(t.state)) row.done += 1;
      counts.set(key, row);
    }
    const campaigns = new Map<string, EditorialReport["operational"]["campaigns"][number]>();
    for (const d of store.deliveries) {
      const t = find(d.taskId);
      const a = store.accounts.find((x) => x.id === d.socialAccountId);
      if (!t || !a || !scoped.some((p) => p.id === t.productId) || !inMonth(d.sentAt ?? d.scheduledAt)) continue;
      const key = `${t.productId}/${a.channel}`;
      const row = campaigns.get(key) ?? { productId: t.productId, channel: a.channel, scheduled: 0, handedOff: 0, sent: 0, failed: 0, cancelled: 0 };
      if (d.status === "scheduled") row.scheduled += 1;
      if (d.status === "handed_off") row.handedOff += 1;
      if (d.status === "sent") row.sent += 1;
      if (d.status === "failed") row.failed += 1;
      if (d.status === "cancelled") row.cancelled += 1;
      campaigns.set(key, row);
    }
    const objectives = store.objectives
      .filter((o) => o.active && scoped.some((p) => p.id === o.productId))
      .map((o) => {
        const actual =
          o.metric === "tasks_completed"
            ? store.tasks.filter((t) => t.productId === o.productId && DONE.includes(t.state) && (!o.taskType || t.type === o.taskType)).length
            : 0;
        return { objective: o, actual, ratio: Math.round((actual / o.target) * 1000) / 1000 };
      });
    const verified: EditorialReport["verified"] = scoped.map((p) =>
      metricsConnected
        ? {
            productId: p.id,
            status: "connected" as const,
            provider: "http-json-metrics",
            snapshots:
              p.id === "insight"
                ? [
                    {
                      targetKind: "url" as const,
                      targetRef: "https://insight.example/fr/posts/neon-vs-supabase",
                      provider: "http-json-metrics",
                      measuredAt: `${month}-03T06:00:00.000Z`,
                      fetchedAt: `${month}-03T06:05:00.000Z`,
                      metrics: { impressions: 1240, clicks: 87 },
                    },
                  ]
                : [],
            totals: (p.id === "insight" ? { impressions: 1240, clicks: 87 } : {}) as Record<string, number>,
          }
        : {
            productId: p.id,
            status: "not_connected" as const,
            reason: "Aucune source vérifiée n'est connectée (fournisseur mock-metrics) : configurez INTEGRATION_METRICS_MODE=live, METRICS_BASE_URL et le secret METRICS_TOKEN.",
          },
    );
    const body: EditorialReport = {
      month,
      from: from.toISOString(),
      to: to.toISOString(),
      generatedAt: stamp(),
      operational: { tasks: [...counts.values()], publishedArticles: [], campaigns: [...campaigns.values()] },
      objectives,
      verified,
      products: scoped.map((p) => ({ id: p.id, name: p.name, seoMonitorUrl: p.seoMonitorUrl })),
    };
    return json(route, 200, body);
  });

  await page.route("**/reports/metrics/refresh", (route) => {
    if (!isAdmin()) return json(route, 403, problem(403, "Admins only"));
    if (!metricsConnected) {
      return json(route, 409, {
        ...problem(409, "Metrics provider not connected"),
        type: "https://trigenys.com/problems/metrics-not-connected",
        detail: "Aucune source vérifiée n'est connectée.",
      });
    }
    return json(route, 200, { provider: "http-json-metrics", considered: 2, written: 2, unchanged: 0, errors: [] });
  });

  await page.route("**/products/*/objectives", (route) => {
    const productId = new URL(route.request().url()).pathname.split("/").at(-2)!;
    const mine = store.objectives.filter((o) => o.productId === productId);
    if (route.request().method() === "GET") return json(route, 200, mine);
    if (!isAdmin()) return json(route, 403, problem(403, "Admins only"));
    const body = route.request().postDataJSON() as { metric: ContractObjective["metric"]; taskType?: string; channel?: string; target: number };
    if (mine.some((o) => o.active && o.metric === body.metric && (o.taskType ?? null) === (body.taskType ?? null) && (o.channel ?? null) === (body.channel ?? null))) {
      return json(route, 409, problem(409, "Objective already defined"));
    }
    const o: ContractObjective = {
      id: uuid(),
      productId,
      metric: body.metric,
      taskType: body.taskType ?? null,
      channel: body.channel ?? null,
      period: "month",
      target: body.target,
      active: true,
      version: 1,
      createdBy: whoami.userId,
      createdAt: stamp(),
      updatedAt: stamp(),
    };
    store.objectives.push(o);
    return json(route, 201, o);
  });

  await page.route("**/objectives/*", (route) => {
    if (!isAdmin()) return json(route, 403, problem(403, "Admins only"));
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    const o = store.objectives.find((x) => x.id === id);
    if (!o) return json(route, 404, problem(404, "Unknown objective"));
    const body = route.request().postDataJSON() as { version: number; target?: number; active?: boolean };
    if (body.version !== o.version) return json(route, 409, problem(409, "Version conflict"));
    Object.assign(o, { target: body.target ?? o.target, active: body.active ?? o.active, version: o.version + 1, updatedAt: stamp() });
    return json(route, 200, o);
  });

  await page.route("**/products/*", (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    if (!isAdmin()) return json(route, 403, problem(403, "Admins only"));
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    const p = store.products.find((x) => x.id === id);
    if (!p) return json(route, 404, problem(404, "Unknown product"));
    const body = route.request().postDataJSON() as { seoMonitorUrl: string | null };
    p.seoMonitorUrl = body.seoMonitorUrl;
    return json(route, 200, p);
  });
}
