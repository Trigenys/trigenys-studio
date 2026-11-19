import { afterEach, describe, expect, it, vi } from "vitest";
import { NotifyMailer } from "../src/integrations/notify/mailer.ts";
import { NotifyWhatsApp } from "../src/integrations/notify/whatsapp.ts";
import { defaultFetch } from "../src/integrations/upstream.ts";

// Workers reject the global fetch called with any `this` other than the global
// scope ("Illegal invocation"). Node does not, so the stub reproduces the rule:
// adapters built without an injected fetch must still call it unbound.
function workersLikeFetch(status: number, body: unknown) {
  return function (this: unknown, ..._args: Parameters<typeof fetch>) {
    if (this !== undefined && this !== globalThis) {
      throw new TypeError("Illegal invocation: function called with incorrect `this` reference.");
    }
    return Promise.resolve(Response.json(body, { status }));
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("default fetch of the HTTP adapters", () => {
  it("defaultFetch calls the global fetch unbound", async () => {
    vi.stubGlobal("fetch", workersLikeFetch(200, { ok: true }));
    const holder = { fetchImpl: defaultFetch };
    const res = await holder.fetchImpl("https://example.test/");
    expect(res.status).toBe(200);
  });

  it("NotifyMailer sends without an injected fetch", async () => {
    vi.stubGlobal("fetch", workersLikeFetch(202, { accepted: true }));
    const mailer = new NotifyMailer({ baseUrl: "https://notify.example.test", ingestKey: "k" });
    await expect(
      mailer.send({ to: "someone@example.test", template: "magic-link", subject: "Lien", text: "https://studio.example.test/x" }),
    ).resolves.toBeUndefined();
  });

  it("NotifyWhatsApp sends without an injected fetch", async () => {
    vi.stubGlobal("fetch", workersLikeFetch(202, { accepted: true }));
    const wa = new NotifyWhatsApp({ baseUrl: "https://notify.example.test", ingestKey: "k" });
    await expect(wa.send({ text: "Nouvelle tâche", key: "t1" })).resolves.toBeUndefined();
  });
});
