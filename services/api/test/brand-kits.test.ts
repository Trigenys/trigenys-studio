import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditEvent, product } from "../src/db/schema.ts";
import { createHarness, type Harness } from "./support/harness.ts";

let h: Harness;
let admin: string;
let operator: string;

const json = { "content-type": "application/json" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parse = (res: Response): Promise<any> => res.json();
const send = (method: string, path: string, body: unknown, token: string, headers: Record<string, string> = {}) =>
  h.request(path, { method, headers: { ...json, ...headers }, body: JSON.stringify(body) }, token);

export const SVG_LOGO = btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
export const kitBody = (name = "Kit 1", extra: Record<string, unknown> = {}) => ({
  name,
  palette: { primary: "#1d4ed8", secondary: "#0f172a", background: "#ffffff", text: "#111827" },
  fontFamily: "Inter, Arial, sans-serif",
  mentions: "© Trigenys",
  logo: { mime: "image/svg+xml", base64: SVG_LOGO },
  ...extra,
});

beforeAll(async () => {
  h = await createHarness();
  admin = await h.signIn("admin@example.com");
  operator = await h.signIn("operator@example.com");
  await h.grant(await h.userIdOf(admin), "admin");
  await h.grant(await h.userIdOf(operator), "operator", "insight");
  await h.db.insert(product).values([{ id: "insight", name: "Trigenys Insight" }]);
});
afterAll(() => h.close());

describe("visual formats", () => {
  it("are seeded by migration and readable by operators", async () => {
    const res = await h.request("/visual-formats", {}, operator);
    expect(res.status).toBe(200);
    const formats = await parse(res);
    expect(formats.map((f: { id: string }) => f.id)).toEqual(["article", "instagram", "linkedin", "story"]);
    expect(formats[0]).toMatchObject({ width: 1200, height: 630, active: true, layout: { logoPosition: "top-left" } });
  });

  it("upsert is admin-only and converges: a second identical PUT writes nothing", async () => {
    const body = { label: "Carré test", width: 800, height: 800, channel: "x", layout: { padding: 40, titleSize: 48, subtitleSize: 24, logoHeight: 40, logoPosition: "top-right", titleMaxLines: 2 } };
    expect((await send("PUT", "/visual-formats/carre", body, operator)).status).toBe(403);
    expect((await send("PUT", "/visual-formats/carre", body, admin)).status).toBe(201);
    expect((await send("PUT", "/visual-formats/carre", body, admin)).status).toBe(200);
    const events = await h.db.select().from(auditEvent).where(eq(auditEvent.action, "visualformat.upsert"));
    expect(events).toHaveLength(1);
    expect((await send("PUT", "/visual-formats/carre", { ...body, active: false }, admin)).status).toBe(200);
    expect((await parse(await h.request("/visual-formats", {}, admin))).some((f: { id: string }) => f.id === "carre")).toBe(false);
    expect((await parse(await h.request("/visual-formats?include=inactive", {}, admin))).some((f: { id: string }) => f.id === "carre")).toBe(true);
  });
});

describe("brand kits", () => {
  let kit1: string;

  it("admin creates a draft kit with a hashed logo; operators cannot", async () => {
    expect((await send("POST", "/products/insight/brand-kits", kitBody(), operator)).status).toBe(403);
    expect((await send("POST", "/products/nope/brand-kits", kitBody(), admin)).status).toBe(404);
    const res = await send("POST", "/products/insight/brand-kits", kitBody(), admin, { "idempotency-key": "kit-1" });
    expect(res.status).toBe(201);
    const kit = await parse(res);
    kit1 = kit.id;
    expect(kit).toMatchObject({ n: 1, status: "draft", logoMime: "image/svg+xml", productId: "insight" });
    expect(kit.logoHash).toMatch(/^[0-9a-f]{64}$/);
    expect(kit.kitHash).toMatch(/^[0-9a-f]{64}$/);
    expect(kit.logoKey).toBeUndefined();
    expect(h.media.objects.has(`logos/sha256/${kit.logoHash}.svg`)).toBe(true);
    // Replay with the same key: same kit, no second row.
    const replay = await send("POST", "/products/insight/brand-kits", kitBody(), admin, { "idempotency-key": "kit-1" });
    expect((await parse(replay)).id).toBe(kit1);
    expect((await parse(await h.request("/products/insight/brand-kits", {}, operator))).length).toBe(1);
  });

  it("refuses a logo that is too large or not of the declared type", async () => {
    const big = btoa("x".repeat(300 * 1024));
    const res = await send("POST", "/products/insight/brand-kits", kitBody("Big", { logo: { mime: "image/svg+xml", base64: big } }), admin);
    expect([413, 400]).toContain(res.status);
    const wrong = await send("POST", "/products/insight/brand-kits", kitBody("Png", { logo: { mime: "image/png", base64: SVG_LOGO } }), admin);
    expect(wrong.status).toBe(422);
  });

  it("serves the logo bytes to readers with integrity headers", async () => {
    const res = await h.request(`/brand-kits/${kit1}/logo`, {}, operator);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("etag")).toMatch(/^"[0-9a-f]{64}"$/);
    expect(await res.text()).toContain("<svg");
  });

  it("approval retires the previous approved kit and is idempotent", async () => {
    expect((await send("POST", `/brand-kits/${kit1}/approve`, {}, operator)).status).toBe(403);
    const first = await send("POST", `/brand-kits/${kit1}/approve`, {}, admin);
    expect(first.status).toBe(200);
    expect((await parse(first)).status).toBe("approved");
    expect((await parse(await send("POST", `/brand-kits/${kit1}/approve`, {}, admin))).status).toBe("approved");

    const kit2 = await parse(await send("POST", "/products/insight/brand-kits", kitBody("Kit 2"), admin));
    expect(kit2.n).toBe(2);
    expect((await parse(await send("POST", `/brand-kits/${kit2.id}/approve`, {}, admin))).status).toBe("approved");
    const kits = await parse(await h.request("/products/insight/brand-kits", {}, admin));
    expect(kits.map((k: { n: number; status: string }) => [k.n, k.status])).toEqual([
      [2, "approved"],
      [1, "retired"],
    ]);
    // A retired kit cannot come back.
    expect((await send("POST", `/brand-kits/${kit1}/approve`, {}, admin)).status).toBe(409);
    const events = await h.db.select().from(auditEvent).where(eq(auditEvent.action, "brandkit.approve"));
    expect(events).toHaveLength(2);
  });
});
