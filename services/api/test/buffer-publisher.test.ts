import { describe, expect, it } from "vitest";
import { BufferPublisher } from "../src/integrations/buffer/publisher.ts";

type Call = { url: string; init: RequestInit };

function fetchStub(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: Call[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  }) as unknown as typeof fetch;
  return Object.assign(f, { calls });
}

const KEY = "buffer-secret-key-123";
const now = () => new Date("2026-11-05T10:00:00Z");
const request = { accountRef: "ch_1", channel: "linkedin" as const, body: "Hello", scheduledAt: "2026-11-06T09:00:00Z", idempotencyKey: "k1", mediaUrls: [] as string[] };

describe("BufferPublisher", () => {
  it("schedules a post through createPost and returns the external id", async () => {
    const f = fetchStub(200, { data: { createPost: { __typename: "PostActionSuccess", post: { id: "p1", status: "scheduled" } } } });
    const p = new BufferPublisher({ apiKey: KEY, baseUrl: "https://api.example.test/", fetch: f, now });
    const res = await p.publish(request);
    expect(res).toEqual({ status: "scheduled", externalId: "p1" });
    expect(f.calls[0]!.url).toBe("https://api.example.test/");
    expect(new Headers(f.calls[0]!.init.headers).get("authorization")).toBe(`Bearer ${KEY}`);
    const sent = JSON.parse(f.calls[0]!.init.body as string);
    expect(sent.variables.input).toMatchObject({ text: "Hello", channelId: "ch_1", mode: "customScheduled", dueAt: "2026-11-06T09:00:00.000Z" });
  });

  it("shares now when the due time is imminent", async () => {
    const f = fetchStub(200, { data: { createPost: { __typename: "PostActionSuccess", post: { id: "p2" } } } });
    const p = new BufferPublisher({ apiKey: KEY, fetch: f, now });
    const res = await p.publish({ ...request, scheduledAt: "2026-11-05T10:00:30Z" });
    expect(res).toEqual({ status: "published", externalId: "p2" });
    expect(JSON.parse(f.calls[0]!.init.body as string).variables.input.mode).toBe("shareNow");
  });

  it("maps a MutationError to a fatal failure", async () => {
    const f = fetchStub(200, { data: { createPost: { __typename: "MutationError", message: "Channel disconnected" } } });
    const res = await new BufferPublisher({ apiKey: KEY, fetch: f, now }).publish(request);
    expect(res).toMatchObject({ status: "failed", retryable: false, code: "rejected" });
    expect((res as { error: string }).error).toContain("Channel disconnected");
  });

  it("maps 429 to a retryable failure with Retry-After", async () => {
    const f = fetchStub(429, "", { "retry-after": "120" });
    const res = await new BufferPublisher({ apiKey: KEY, fetch: f, now }).publish(request);
    expect(res).toMatchObject({ status: "failed", retryable: true, retryAfterSeconds: 120, code: "rate_limit" });
  });

  it("maps 401 to a fatal auth failure and never leaks the key", async () => {
    const f = fetchStub(401, { error: "bad key" });
    const res = await new BufferPublisher({ apiKey: KEY, fetch: f, now }).publish(request);
    expect(res).toMatchObject({ status: "failed", retryable: false, code: "auth" });
    expect(JSON.stringify(res)).not.toContain(KEY);
  });

  it("maps a 5xx and a network error to retryable failures", async () => {
    expect(await new BufferPublisher({ apiKey: KEY, fetch: fetchStub(503, ""), now }).publish(request)).toMatchObject({ retryable: true, code: "upstream" });
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const res = await new BufferPublisher({ apiKey: KEY, fetch: failing, now }).publish(request);
    expect(res).toMatchObject({ retryable: true, code: "network" });
    expect(JSON.stringify(res)).not.toContain(KEY);
  });

  it("times out as a retryable failure", async () => {
    const hanging = ((_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      })) as unknown as typeof fetch;
    const res = await new BufferPublisher({ apiKey: KEY, fetch: hanging, now, timeoutMs: 5 }).publish(request);
    expect(res).toMatchObject({ retryable: true, code: "timeout" });
  });

  it("looks up a lost send by channel, text and creation time", async () => {
    const f = fetchStub(200, {
      data: {
        posts: {
          edges: [
            { node: { id: "old", status: "sent", text: "Hello", createdAt: "2026-11-01T00:00:00Z" } },
            { node: { id: "p9", status: "scheduled", text: "Hello", createdAt: "2026-11-05T09:59:00Z" } },
            { node: { id: "other", status: "scheduled", text: "Bye", createdAt: "2026-11-05T09:59:00Z" } },
          ],
        },
      },
    });
    const p = new BufferPublisher({ apiKey: KEY, fetch: f, now });
    expect(await p.lookup({ accountRef: "ch_1", body: "Hello", since: "2026-11-05T09:58:00Z" })).toEqual({ externalId: "p9", status: "scheduled" });
    expect(await p.lookup({ accountRef: "ch_1", body: "Nope", since: "2026-11-05T09:58:00Z" })).toBeNull();
  });

  it("lists the organization's channels as provider accounts", async () => {
    const f = fetchStub(200, { data: { channels: [{ id: "c1", name: "Trigenys", service: "LinkedIn" }] } });
    const p = new BufferPublisher({ apiKey: KEY, fetch: f, now, organizationId: "org1" });
    expect(await p.listAccounts()).toEqual([{ externalRef: "c1", service: "linkedin", name: "Trigenys" }]);
    expect(JSON.parse(f.calls[0]!.init.body as string).variables).toEqual({ organizationId: "org1" });
  });

  it("reports a post's status", async () => {
    const f = fetchStub(200, { data: { post: { id: "p1", status: "sent" } } });
    expect(await new BufferPublisher({ apiKey: KEY, fetch: f, now }).status("p1")).toEqual({ externalId: "p1", status: "sent" });
  });
});
