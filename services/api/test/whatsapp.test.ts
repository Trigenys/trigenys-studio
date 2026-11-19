import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { notificationChannels } from "../src/alerts/assignment.ts";
import { dispatchNotifications } from "../src/alerts/notify.ts";
import { notificationDispatch, product } from "../src/db/schema.ts";
import type { Bindings } from "../src/env.ts";
import { MockGroupMessenger } from "../src/integrations/mock/group-messenger.ts";
import { groupPayload, NotifyWhatsApp } from "../src/integrations/notify/whatsapp.ts";
import { createIntegrations, IntegrationNotAvailableError } from "../src/integrations/registry.ts";
import { UpstreamError } from "../src/integrations/upstream.ts";
import { createHarness, type Harness } from "./support/harness.ts";

// Team group chat (ADR 0014): an assignment listed in WHATSAPP_NOTIFY_EVENTS
// also queues a group message, sent through Trigenys Notify's generic
// WhatsApp route with a link to the task and without any e-mail address.

let h: Harness;
let admin: string;
let tiffany: string;
let tiffanyId: string;

const json = { "content-type": "application/json" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parse = (res: Response): Promise<any> => res.json();
const createTask = (body: unknown, key: string) =>
  h.request("/tasks", { method: "POST", headers: { ...json, "idempotency-key": key }, body: JSON.stringify(body) }, admin);
const rows = (taskId: string) => h.db.select().from(notificationDispatch).where(eq(notificationDispatch.taskId, taskId));

beforeAll(async () => {
  h = await createHarness({ env: { WHATSAPP_NOTIFY_EVENTS: "task_assigned" } });
  admin = await h.signIn("admin@example.com");
  tiffany = await h.signIn("tiffany@example.com", "Tiffany");
  tiffanyId = await h.userIdOf(tiffany);
  await h.grant(await h.userIdOf(admin), "admin");
  await h.grant(tiffanyId, "operator", "insight");
  await h.db.insert(product).values({ id: "insight", name: "Trigenys Insight" });
});
afterAll(() => h.close());

describe("group notifications for assignments", () => {
  it("queues an e-mail and a group message once per assignment", async () => {
    const body = { productId: "insight", type: "post", title: "Carrousel lancement", brief: "Brief confidentiel", assigneeId: tiffanyId };
    const t = await parse(await createTask(body, "wa-1"));
    const queued = await rows(t.id);
    expect(queued.map((r) => r.channel).sort()).toEqual(["email", "whatsapp"]);
    expect(queued.find((r) => r.channel === "email")?.dedupKey).toBe(`task_assigned:${t.id}:${tiffanyId}:${t.version}`);
    expect(queued.find((r) => r.channel === "whatsapp")?.dedupKey).toBe(`task_assigned:whatsapp:${t.id}:${tiffanyId}:${t.version}`);

    await createTask(body, "wa-1");
    expect(await rows(t.id)).toHaveLength(2);
  });

  it("sends the group message with the assignee, the product and a link, never the address or the brief", async () => {
    const group = new MockGroupMessenger();
    const t = await parse(await createTask({ productId: "insight", type: "post", title: "Post LinkedIn", brief: "Brief confidentiel", assigneeId: tiffanyId, dueAt: "2026-12-01T09:00:00.000Z" }, "wa-2"));
    const report = await dispatchNotifications({ db: h.db, mailer: h.mailer, whatsapp: group, now: () => new Date(), webAppUrl: "https://studio.example/" });
    expect(report.failed).toBe(0);

    const message = group.sent.find((m) => m.text.includes("Post LinkedIn"));
    expect(message).toMatchObject({
      text: "Nouvelle tâche pour Tiffany : Post LinkedIn\nProduit : Trigenys Insight\nÉchéance : 2026-12-01",
      link: `https://studio.example/tasks/${t.id}`,
      linkLabel: "Ouvrir dans le Studio",
    });
    expect(message?.text).not.toContain("@");
    expect(message?.text).not.toContain("confidentiel");
    expect(h.mailer.sent.some((m) => m.to === "tiffany@example.com" && m.text.includes("Post LinkedIn"))).toBe(true);

    const sent = (await rows(t.id)).find((r) => r.channel === "whatsapp");
    expect(sent).toMatchObject({ status: "sent", provider: "mock-group-messenger", attempts: 1 });
  });

  it("skips the group message when no group messenger is configured, and still sends the e-mail", async () => {
    const t = await parse(await createTask({ productId: "insight", type: "post", title: "Story", assigneeId: tiffanyId }, "wa-3"));
    await dispatchNotifications({ db: h.db, mailer: h.mailer, now: () => new Date(), webAppUrl: "https://studio.example/" });
    const byChannel = Object.fromEntries((await rows(t.id)).map((r) => [r.channel, r]));
    expect(byChannel.email?.status).toBe("sent");
    expect(byChannel.whatsapp).toMatchObject({ status: "skipped", lastError: "Le canal WhatsApp n'est pas configuré pour cet envoi." });
  });

  it("queues no group message unless the event is listed", () => {
    expect(notificationChannels({}, "task_assigned")).toEqual(["email"]);
    expect(notificationChannels({ WHATSAPP_NOTIFY_EVENTS: "alert, other" }, "task_assigned")).toEqual(["email"]);
    expect(notificationChannels({ WHATSAPP_NOTIFY_EVENTS: " task_assigned ,x" }, "task_assigned")).toEqual(["email", "whatsapp"]);
  });
});

describe("NotifyWhatsApp adapter", () => {
  const now = new Date("2026-11-19T10:00:00.000Z");
  type Call = { url: string; headers: Headers; body: Record<string, unknown> };
  const recorder = (status: number, payload: unknown) => {
    const calls: Call[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(payload), { status, headers: json });
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  };
  const adapter = (fetchImpl: typeof fetch) => new NotifyWhatsApp({ baseUrl: "https://notify.example/", ingestKey: "k".repeat(40), fetch: fetchImpl, now: () => now });

  it("posts a contract v1 event to the project route with the WhatsApp key", async () => {
    const { calls, fetchImpl } = recorder(202, { accepted: true });
    const wa = adapter(fetchImpl);
    await wa.send({ text: "Bonjour", link: "https://studio.example/tasks/1", linkLabel: "Ouvrir", key: "d1:1" });
    await wa.send({ text: "Bonjour", link: "https://studio.example/tasks/1", linkLabel: "Ouvrir", key: "d1:1" });
    await wa.send({ text: "Bonjour", key: "d1:2" });

    expect(calls[0]!.url).toBe("https://notify.example/v1/dispatch/trigenys-studio/whatsapp");
    expect(calls[0]!.headers.get("x-notify-auth")).toBe("k".repeat(40));
    expect(calls[0]!.body).toEqual({
      version: 1,
      project: "trigenys-studio",
      id: expect.stringMatching(/^[0-9a-f]{64}$/),
      occurredAt: "2026-11-19T10:00:00.000Z",
      expiresAt: "2026-11-20T10:00:00.000Z",
      message: { text: "Bonjour", link: "https://studio.example/tasks/1", linkLabel: "Ouvrir" },
    });
    // Same attempt, same event id (deduplicated by Notify); a new attempt is a new event.
    expect(calls[1]!.body.id).toBe(calls[0]!.body.id);
    expect(calls[2]!.body.id).not.toBe(calls[0]!.body.id);
    expect(calls[2]!.body.message).toEqual({ text: "Bonjour" });
  });

  it("reports the status and Notify's error code only, never the response body", async () => {
    const { fetchImpl } = recorder(503, { error: "CHANNEL_DISABLED" });
    const error = await adapter(fetchImpl).send({ text: "x", key: "d2:1" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UpstreamError);
    expect((error as Error).message).toContain("HTTP 503 CHANNEL_DISABLED");

    const leaky = recorder(400, { error: "invalid event for +33600000000" });
    const leak = await adapter(leaky.fetchImpl).send({ text: "x", key: "d2:2" }).catch((e: unknown) => e);
    expect((leak as Error).message).toContain("HTTP 400");
    expect((leak as Error).message).not.toContain("+33");

    const refused = recorder(202, { accepted: false });
    await expect(adapter(refused.fetchImpl).send({ text: "x", key: "d2:3" })).rejects.toThrow("event not accepted");
  });

  it("shapes the message to the contract", () => {
    expect(groupPayload({ text: "a\r\nb\tc\u0007", key: "k" })).toEqual({ text: "a\nb c" });
    expect(groupPayload({ text: "x", link: "http://localhost:5173/tasks/1", linkLabel: "Ouvrir", key: "k" })).toEqual({ text: "x" });
    expect(groupPayload({ text: "x", link: "https://s.example/t", linkLabel: "Ouvrir\nla tâche", key: "k" })).toEqual({ text: "x", link: "https://s.example/t", linkLabel: "Ouvrir la tâche" });
    expect(groupPayload({ text: "y".repeat(5000), key: "k" }).text).toHaveLength(2000);
    expect(groupPayload({ text: " \n ", key: "k" }).text).toBe("(message vide)");
  });
});

describe("whatsapp integration selection", () => {
  const env = (extra: Partial<Bindings>): Bindings => ({ INTEGRATION_WHATSAPP_MODE: "live", ...extra });

  it("requires the WhatsApp key and a Notify base in live mode", () => {
    expect(() => createIntegrations(env({ NOTIFY_EMAIL_BASE_URL: "https://notify.example" }))).toThrow(IntegrationNotAvailableError);
    expect(() => createIntegrations(env({ NOTIFY_WHATSAPP_INGEST_KEY: "k".repeat(40) }))).toThrow(/NOTIFY_WHATSAPP_INGEST_KEY/);
    expect(createIntegrations(env({ NOTIFY_EMAIL_BASE_URL: "https://notify.example", NOTIFY_WHATSAPP_INGEST_KEY: "k".repeat(40) })).whatsapp.name).toBe(
      "trigenys-notify-whatsapp",
    );
    expect(createIntegrations({}).whatsapp.name).toBe("mock-group-messenger");
  });
});
