import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseConfigFileTextToJson } from "typescript";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createApp, type App } from "../src/app.ts";
import { product } from "../src/db/schema.ts";
import type { Bindings } from "../src/env.ts";
import { authConfig, createHarness, type Harness } from "./support/harness.ts";

const file = fileURLToPath(new URL("../wrangler.production.jsonc", import.meta.url).href);
const production = parseConfigFileTextToJson(file, readFileSync(file, "utf8")).config;

// The bucket outlives requests and app instances, like an external R2 binding.
// Do not inject the harness's shared MemoryMediaStore: that hid the production
// bug, where every request created a new, empty store in mock mode.
const objects = new Map<string, { bytes: Uint8Array; mime?: string }>();
const bucket = {
  async put(key: string, value: Uint8Array | ArrayBuffer, options?: R2PutOptions) {
    const bytes = value instanceof Uint8Array ? value.slice() : new Uint8Array(value).slice();
    const metadata = options?.httpMetadata;
    objects.set(key, { bytes, mime: metadata instanceof Headers ? metadata.get("content-type") ?? undefined : metadata?.contentType });
  },
  async get(key: string) {
    const object = objects.get(key);
    return object ? { arrayBuffer: async () => object.bytes.slice().buffer, httpMetadata: { contentType: object.mime } } : null;
  },
} as unknown as R2Bucket;

const env: Bindings = {
  INTEGRATION_MEDIA_MODE: production.vars.INTEGRATION_MEDIA_MODE,
  ...(production.r2_buckets?.some((binding: { binding: string }) => binding.binding === "VISUALS") ? { VISUALS: bucket } : {}),
};
let h: Harness;
let token: string;
const freshApp = () => createApp({ db: h.db, authConfig, integrations: { email: h.mailer } });
const request = (app: App, path: string, method = "GET", body?: unknown, signedIn = true) =>
  app.request(path, {
    method,
    headers: { "content-type": "application/json", ...(signedIn ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);

beforeAll(async () => {
  h = await createHarness();
  token = await h.signIn("media-admin@example.com");
  await h.grant(await h.userIdOf(token), "admin");
  await h.db.insert(product).values({ id: "insight", name: "Trigenys Insight" });
}, 20_000);
afterAll(async () => { await h?.close(); });

it("production keeps uploaded logos and rendered files across requests and fresh app instances", async () => {
  const logo = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
  const upload = await request(freshApp(), "/products/insight/brand-kits", "POST", {
    name: "Persistent media",
    palette: { primary: "#7F2044", secondary: "#55162F", background: "#FCFAFB", text: "#251C2A" },
    fontFamily: "Arial",
    logo: { mime: "image/svg+xml", base64: btoa(logo) },
  });
  expect(upload.status).toBe(201);
  const kit = await upload.json() as { id: string; logoHash: string };

  const readLogo = await request(freshApp(), `/brand-kits/${kit.id}/logo`);
  expect(readLogo.status).toBe(200);
  expect(await readLogo.text()).toBe(logo);
  expect(readLogo.headers.get("etag")).toBe(`"${kit.logoHash}"`);

  expect((await request(freshApp(), `/brand-kits/${kit.id}/approve`, "POST", {})).status).toBe(200);
  const created = await request(freshApp(), "/tasks", "POST", { productId: "insight", type: "post", title: "Persistent visual" });
  expect(created.status).toBe(201);
  const task = await created.json() as { id: string };
  const rendered = await request(freshApp(), `/tasks/${task.id}/visuals`, "POST", { formatId: "linkedin" });
  expect(rendered.status).toBe(201);
  const visual = await rendered.json() as { id: string; contentHash: string };

  const readFile = await request(freshApp(), `/visuals/${visual.id}/file`);
  expect(readFile.status).toBe(200);
  expect(readFile.headers.get("content-type")).toBe("image/svg+xml");
  expect(readFile.headers.get("etag")).toBe(`"${visual.contentHash}"`);
  expect(await readFile.text()).toContain("Persistent visual");

  expect((await request(freshApp(), `/brand-kits/${kit.id}/logo`, "GET", undefined, false)).status).toBe(401);
  expect((await request(freshApp(), `/visuals/${visual.id}/file`, "GET", undefined, false)).status).toBe(401);
});
