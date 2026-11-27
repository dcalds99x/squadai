/**
 * End-to-end tests: the real web app and worker, a real Postgres, the demo model.
 *
 *   pnpm build && pnpm e2e        (DATABASE_URL must point at a migrated database)
 *   E2E_BROWSER=msedge pnpm e2e   (use an installed browser instead of Playwright's)
 *
 * Starts the built web app on :3100 and a worker, unless they already run
 * (locally they are reused; CI always starts fresh ones).
 */
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE = `http://localhost:${PORT}`;
const env = {
  ...(process.env as Record<string, string>),
  BETTER_AUTH_URL: BASE,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "e2e-only-secret-not-used-anywhere-else",
  // The demo model answers fast in tests.
  SQUADAI_DEMO_DELAY_MS: "50",
};

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 900 },
    // Use an installed browser instead of Playwright's own, e.g. E2E_BROWSER=msedge or chrome.
    ...(process.env.E2E_BROWSER ? { channel: process.env.E2E_BROWSER } : {}),
  },
  webServer: [
    {
      command: "pnpm --filter @squadai/worker start",
      env,
      wait: { stdout: /worker started/ },
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
    },
    {
      command: `pnpm --filter @squadai/web exec next start -p ${PORT}`,
      env,
      url: `${BASE}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
