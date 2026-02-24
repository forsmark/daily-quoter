import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let providerModule: typeof import("../../src/providers");
let dbModule: typeof import("../../src/db");
let tempDir = "";
let dbPath = "";

function resetDbState(path: string): void {
  const db = new Database(path, { create: true });
  db.query("DELETE FROM quote_history").run();
  db.query("DELETE FROM settings").run();
  db.query("DELETE FROM hidden_quotes").run();
  db.query("DELETE FROM allowlist_quotes").run();
  db.query("DELETE FROM daily_cache").run();
  db.close();
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "daily-quoter-provider-test-"));
  dbPath = join(tempDir, "daily-quoter.provider.test.sqlite");

  process.env.DAILY_QUOTER_DB_PATH = dbPath;
  process.env.DISABLE_REMOTE_APIS = "1";
  dbModule = await import(`../../src/db.ts?test=${Date.now()}`);
  providerModule = await import(`../../src/providers.ts?test=${Date.now()}`);
});

afterEach(() => {
  resetDbState(dbPath);
});

afterAll(() => {
  delete process.env.DISABLE_REMOTE_APIS;
  delete process.env.DAILY_QUOTER_DB_PATH;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("providers fallback mode", () => {
  test("returns fallback quotes when remote APIs are disabled", async () => {
    const response = await providerModule.getQuoteSuggestions(4, new Set());
    expect(response.source).toBe("fallback");
    expect(response.quotes.length).toBe(4);
    expect(response.exhausted).toBe(false);
  });

  test("returns fallback backgrounds when remote APIs are disabled", async () => {
    const response = await providerModule.getBackgroundChoices(3);
    expect(response.source).toBe("fallback");
    expect(response.backgrounds.length).toBeGreaterThan(0);
    expect(response.backgrounds.length).toBeLessThanOrEqual(3);
  });

  test("prioritizes allowlist and excludes hidden quotes", async () => {
    dbModule.addAllowlistQuote({
      text: "Ship value every day.",
      author: "Team",
      attribution: "Guideline",
    });
    dbModule.addHiddenQuote("Ship value every day.");

    const response = await providerModule.getQuoteSuggestions(5, new Set());
    expect(response.quotes.some((entry) => entry.text === "Ship value every day.")).toBe(false);

    dbModule.removeHiddenQuote("Ship value every day.");
    const next = await providerModule.getQuoteSuggestions(5, new Set());
    expect(next.quotes.some((entry) => entry.text === "Ship value every day.")).toBe(true);
  });
});
