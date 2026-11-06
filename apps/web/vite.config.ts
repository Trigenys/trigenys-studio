import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import openapi from "../../packages/contracts/openapi.json" with { type: "json" };

// In development the Worker (wrangler, port 8787) is proxied under the same
// origin so the Better Auth httpOnly cookie works without CORS. In production
// VITE_API_URL points at the deployed Worker (or stays empty when the web app
// is served behind the same origin).
const api = process.env.STUDIO_API_PROXY ?? "http://localhost:8787";
// One prefix per top-level API resource, derived from the published contract
// so a new resource is proxied without touching this file. "/api" carries the
// Better Auth routes, which are outside the OpenAPI document.
const apiPrefixes = [
  "/api",
  "/openapi.json",
  ...new Set(Object.keys(openapi.paths).map((p) => "/" + p.split("/")[1])),
];

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: Object.fromEntries(
      apiPrefixes.map((p) => [
        p,
        {
          target: api,
          changeOrigin: false,
          // Deep links such as /tasks/<id> are pages: a browser navigation
          // (Accept: text/html) gets the SPA entry, API calls get the Worker.
          bypass: (req: { headers: { accept?: string } }) =>
            req.headers.accept?.includes("text/html") ? "/index.html" : undefined,
        },
      ]),
    ),
  },
});
