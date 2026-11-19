import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Notify runs as another workers.dev Worker of the same Cloudflare account. A
// plain fetch between two such Workers is refused (HTTP 404, error 1042)
// unless global_fetch_strictly_public is set, and Node-based tests cannot see
// that: the flag itself is the guard.
const configs = ["wrangler.production.jsonc", "wrangler.jsonc"];

describe("Worker configuration", () => {
  for (const file of configs) {
    it(`${file} lets the Worker fetch other Workers of the account`, () => {
      const text = readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url).href), "utf8");
      expect(text).toMatch(/"compatibility_flags":\s*\[[^\]]*"global_fetch_strictly_public"/);
    });
  }
});
