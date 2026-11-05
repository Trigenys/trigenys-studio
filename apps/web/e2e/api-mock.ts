import type { Page, Route } from "@playwright/test";
import type { Me, Product, Task, TaskDetail } from "@trigenys/studio-contracts";

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

export const detailOf = (t: Task): TaskDetail => ({
  ...t,
  brief: "Annoncer la disponibilité d'Insight aux équipes data.",
  latestVersion:
    t.state === "qualifying"
      ? null
      : {
          id: "v-1",
          taskId: t.id,
          n: 1,
          channel: "linkedin",
          body: "Insight est disponible.",
          contentHash: "abc",
          aiAssisted: false,
          authorId: "u-admin",
          createdAt: "2026-01-02T00:00:00.000Z",
        },
  latestApproval: null,
  approvalValid: false,
  allowedTransitions: t.state === "preparing" ? ["reviewing"] : [],
});

type Options = { signedIn?: boolean; tasksStatus?: number };

// Intercepts every API call the app makes; the mock mirrors the Worker's
// filtering by productId so the product filter is exercised for real.
export async function mockApi(page: Page, { signedIn = true, tasksStatus = 200 }: Options = {}) {
  const json = (route: Route, status: number, body: unknown) =>
    route.request().resourceType() === "document"
      ? route.continue() // a page navigation such as /tasks/<id>: let Vite serve the SPA
      : route.fulfill({ status, contentType: status >= 400 ? "application/problem+json" : "application/json", body: JSON.stringify(body) });

  await page.route("**/me", (route) =>
    signedIn ? json(route, 200, me) : json(route, 401, { type: "about:blank", title: "No valid session", status: 401 }),
  );
  await page.route("**/products", (route) => json(route, 200, products));
  await page.route("**/tasks?**", (route) => {
    if (tasksStatus !== 200) return json(route, tasksStatus, { type: "about:blank", title: "Service indisponible", status: tasksStatus });
    const productId = new URL(route.request().url()).searchParams.get("productId");
    return json(route, 200, productId ? tasks.filter((t) => t.productId === productId) : tasks);
  });
  await page.route("**/tasks", (route) =>
    tasksStatus === 200 ? json(route, 200, tasks) : json(route, tasksStatus, { type: "about:blank", title: "Service indisponible", status: tasksStatus }),
  );
  await page.route(/\/tasks\/[0-9a-f-]{36}$/, (route) => {
    const id = route.request().url().split("/").pop();
    const t = tasks.find((x) => x.id === id);
    return t ? json(route, 200, detailOf(t)) : json(route, 404, { type: "about:blank", title: "Not found", status: 404 });
  });
  await page.route(/\/tasks\/[0-9a-f-]{36}\/(transitions|approvals)$/, async (route) => {
    const [, id] = route.request().url().match(/\/tasks\/([0-9a-f-]{36})\//)!;
    const t = tasks.find((x) => x.id === id)!;
    const body = route.request().postDataJSON() as { to?: Task["state"]; decision?: "approved" | "rejected" };
    const state: Task["state"] = body.to ?? (body.decision === "approved" ? "approved" : "rejected");
    return json(route, body.to ? 200 : 201, { ...detailOf({ ...t, state }), allowedTransitions: [] });
  });
}
