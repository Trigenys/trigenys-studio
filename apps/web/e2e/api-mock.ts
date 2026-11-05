import type { Page, Route } from "@playwright/test";
import type { AiInteraction, Comment, ContentVersion, ImportItem, Me, Product, Task, TaskDetail, TaskSource, TaskTransition } from "@trigenys/studio-contracts";

export const me: Me = {
  userId: "u-operator",
  email: "operatrice@example.com",
  name: "Opératrice",
  grants: [{ role: "operator", productId: "insight" }, { role: "reviewer", productId: null }],
};

export const products: Product[] = [
  { id: "insight", name: "Trigenys Insight", createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "precis", name: "Précis Translator", createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "atelier", name: "Atelier Maître", createdAt: "2026-01-01T00:00:00.000Z" },
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

const FROZEN: Task["state"][] = ["scheduled", "published", "measured"];

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
    latestApproval: null,
    approvalValid: false,
    allowedTransitions: allowed(t, latestVersion !== null),
  };
};

type Options = { signedIn?: boolean; tasksStatus?: number; updateStatus?: number; reviewerOnly?: boolean };

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
export async function mockApi(page: Page, { signedIn = true, tasksStatus = 200, updateStatus = 200, reviewerOnly = false }: Options = {}) {
  const whoami: Me = reviewerOnly ? { ...me, grants: [{ role: "reviewer", productId: null }] } : me;
  const store = {
    tasks: tasks.map((t) => ({ ...t })),
    imports: [] as ImportItem[],
    versions: new Map<string, ContentVersion[]>(),
    comments: new Map<string, Comment[]>(),
    history: new Map<string, TaskTransition[]>(),
    sources: new Map<string, TaskSource[]>(),
    interactions: new Map<string, AiInteraction[]>(),
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
  await page.route("**/products", (route) => json(route, 200, products));

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
}
