import { defineConfig } from "@playwright/test";

const E2E_PORT = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command:
      `DISABLE_REMOTE_APIS=1 DAILY_QUOTER_DB_PATH=/tmp/daily-quoter-e2e.sqlite bun run build ` +
      `&& DISABLE_REMOTE_APIS=1 PORT=${E2E_PORT} DAILY_QUOTER_DB_PATH=/tmp/daily-quoter-e2e.sqlite bun run src/server.ts`,
    url: `http://127.0.0.1:${E2E_PORT}`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
});
