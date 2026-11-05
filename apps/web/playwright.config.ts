import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against the Vite dev server with the API mocked at the
// network layer (see e2e/api-mock.ts): no Worker, no database.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "dot" : "list",
  use: {
    baseURL: "http://localhost:5190",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npx vite --port 5190 --strictPort",
    url: "http://localhost:5190",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
