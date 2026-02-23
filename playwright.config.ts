import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command:
      "DISABLE_REMOTE_APIS=1 PORT=4173 DAILY_QUOTER_DB_PATH=/tmp/daily-quoter-e2e.sqlite bun run start",
    url: "http://127.0.0.1:4173",
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
});
