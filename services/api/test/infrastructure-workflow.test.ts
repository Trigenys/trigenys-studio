import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url).href), "utf8");
const workflow = read("../../../.github/workflows/appfactory-infrastructure.yml");
const worker = JSON.parse(read("../../../.appfactory/worker.json"));

// AppFactory runtime tokens cannot reach the R2 REST API (CLOUDFLARE_R2_ACCESS_DENIED).
// The bucket is created by the Worker release in Workers Builds, so the release
// must carry the recipe and the workflow must check the build evidence.
it("provisions the private media bucket through the Worker release only", () => {
  expect(worker.r2).toEqual({ recipe: "private-media" });
  expect(workflow).not.toContain("/infrastructure/r2");
  expect(workflow).toContain("release.r2.buildCompleted");
  expect(workflow).toMatch(/EXPECTED_MEDIA_BUCKET: trigenys-studio-media/);
});
