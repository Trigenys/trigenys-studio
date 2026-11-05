import { defineConfig } from "vitest/config";

// Routes are exercised through app.request() against the Web Standard runtime.
// Database access is not covered here: it requires a Hyperdrive binding and a lease.
export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
});
