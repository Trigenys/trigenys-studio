import { describe, expect, it } from "vitest";
import { createApp, openApiInfo } from "../src/app.ts";

const app = createApp();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (res: Response): Promise<any> => res.json();

describe("GET /health", () => {
  it("reports ok without touching the database", async () => {
    const res = await app.request("/health", {}, { SERVICE_NAME: "test-api" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: "ok",
      service: "test-api",
      database: "unchecked",
      integrations: { publisher: "mock", cms: "mock", metrics: "mock", llm: "mock" },
    });
  });

  it("reports an unconfigured database on a deep check without binding", async () => {
    const res = await app.request("/health?deep=true", {}, {});
    expect(res.status).toBe(200);
    expect((await json(res)).database).toBe("unconfigured");
  });

  it("rejects an invalid query with a problem document", async () => {
    const res = await app.request("/health?deep=maybe", {}, {});
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect((await json(res)).errors[0].path).toBe("deep");
  });
});

describe("errors", () => {
  it("returns a problem document on unknown routes", async () => {
    const res = await app.request("/nope", {}, {});
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ status: 404, instance: "/nope" });
  });
});

describe("OpenAPI", () => {
  it("serves a 3.1 document with the health route and Problem schema", async () => {
    const res = await app.request("/openapi.json", {}, {});
    expect(res.status).toBe(200);
    const doc = await json(res);
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.version).toBe(openApiInfo.info.version);
    expect(doc.paths["/health"].get).toBeDefined();
    expect(doc.components.schemas.Problem).toBeDefined();
  });
});
