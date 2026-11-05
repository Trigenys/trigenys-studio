import { describe, expect, it } from "vitest";
import { createIntegrations, IntegrationNotAvailableError } from "../src/integrations/registry.ts";

describe("integration registry", () => {
  it("defaults every integration to its mock adapter", async () => {
    const i = createIntegrations({});
    expect([i.publisher.name, i.cms.name, i.metrics.name, i.llm.name]).toEqual([
      "mock-publisher",
      "mock-cms",
      "mock-metrics",
      "mock-llm",
    ]);
    expect(await i.cms.listRecent(10)).toHaveLength(3);
  });

  it("refuses a live mode that has no adapter instead of falling back silently", () => {
    expect(() => createIntegrations({ INTEGRATION_PUBLISHER_MODE: "live" })).toThrow(
      IntegrationNotAvailableError,
    );
  });

  it("mock publisher is idempotent on the idempotency key", async () => {
    const { publisher } = createIntegrations({});
    const req = {
      idempotencyKey: "k1",
      accountRef: "acc",
      channel: "linkedin" as const,
      body: "hello",
      mediaUrls: [],
    };
    const a = await publisher.publish(req);
    const b = await publisher.publish(req);
    expect(a).toEqual(b);
    expect(a.status).toBe("published");
  });
});
