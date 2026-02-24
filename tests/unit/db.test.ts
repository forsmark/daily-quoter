import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tempDir = "";
let dbPath = "";
let dbModule: typeof import("../../src/db");
let fontModule: typeof import("../../src/data/fonts");

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
  tempDir = mkdtempSync(join(tmpdir(), "daily-quoter-db-test-"));
  dbPath = join(tempDir, "daily-quoter.test.sqlite");

  process.env.DAILY_QUOTER_DB_PATH = dbPath;

  dbModule = await import(`../../src/db.ts?test=${Date.now()}`);
  fontModule = await import("../../src/data/fonts.ts");
});

afterEach(() => {
  resetDbState(dbPath);
});

afterAll(() => {
  delete process.env.DAILY_QUOTER_DB_PATH;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("db settings", () => {
  test("returns defaults when no settings are saved", () => {
    expect(dbModule.getQuoteSuggestionCount()).toBe(5);
    expect(dbModule.getBackgroundSuggestionCount()).toBe(8);
    expect(dbModule.getDefaultFontId()).toBe(fontModule.DEFAULT_FONT_ID);
  });

  test("persists quote/background/default font settings", () => {
    dbModule.setQuoteSuggestionCount(9);
    dbModule.setBackgroundSuggestionCount(11);
    dbModule.setDefaultFontId("oswald");

    expect(dbModule.getQuoteSuggestionCount()).toBe(9);
    expect(dbModule.getBackgroundSuggestionCount()).toBe(11);
    expect(dbModule.getDefaultFontId()).toBe("oswald");
  });
});

describe("quote persistence", () => {
  test("saves and returns selected quote with background and font metadata", () => {
    const font = fontModule.FONT_OPTIONS.find((item) => item.id === "jetbrains-mono");
    if (!font) {
      throw new Error("Font option jetbrains-mono not found");
    }

    const saved = dbModule.saveQuoteSelection(
      {
        text: "Consistency compounds.",
        author: "Anonymous",
        attribution: "Team principle",
      },
      {
        id: "bg-1",
        name: "Background 1",
        imageUrl: "https://example.com/bg.jpg",
        credit: "Photo by Example",
        creditUrl: "https://example.com",
      },
      font,
    );

    expect(saved.quote).toBe("Consistency compounds.");
    expect(saved.backgroundId).toBe("bg-1");
    expect(saved.fontId).toBe("jetbrains-mono");
    expect(saved.fontName).toBe("JetBrains Mono");

    const history = dbModule.getQuoteHistory(1);
    expect(history).toHaveLength(1);
    expect(history[0]?.fontFamily).toContain("JetBrains Mono");
    expect(dbModule.getUsedQuotes().has("consistency compounds.")).toBe(true);
  });

  test("can delete a single history entry", () => {
    const font = fontModule.FONT_OPTIONS[0];
    if (!font) {
      throw new Error("Expected at least one font option");
    }

    const first = dbModule.saveQuoteSelection(
      {
        text: "Make each step obvious.",
        author: "Anonymous",
        attribution: "Standup",
      },
      {
        id: "bg-1",
        name: "Background 1",
        imageUrl: "https://example.com/bg-1.jpg",
        credit: "Photo by Example",
      },
      font,
    );
    const second = dbModule.saveQuoteSelection(
      {
        text: "Write tests for behavior.",
        author: "Anonymous",
        attribution: "Standup",
      },
      {
        id: "bg-2",
        name: "Background 2",
        imageUrl: "https://example.com/bg-2.jpg",
        credit: "Photo by Example",
      },
      font,
    );

    const deleted = dbModule.deleteQuoteHistoryEntry(first.id);
    expect(deleted).toBe(true);
    expect(dbModule.deleteQuoteHistoryEntry(9_999_999)).toBe(false);

    const history = dbModule.getQuoteHistory(10);
    expect(history).toHaveLength(1);
    expect(history[0]?.id).toBe(second.id);
    expect(dbModule.getUsedQuotes().has("make each step obvious.")).toBe(false);
  });

  test("can delete all history entries", () => {
    const font = fontModule.FONT_OPTIONS[0];
    if (!font) {
      throw new Error("Expected at least one font option");
    }

    dbModule.saveQuoteSelection(
      {
        text: "Clarity beats cleverness.",
        author: "Anonymous",
        attribution: "Standup",
      },
      {
        id: "bg-3",
        name: "Background 3",
        imageUrl: "https://example.com/bg-3.jpg",
        credit: "Photo by Example",
      },
      font,
    );
    dbModule.saveQuoteSelection(
      {
        text: "Ship small, ship often.",
        author: "Anonymous",
        attribution: "Standup",
      },
      {
        id: "bg-4",
        name: "Background 4",
        imageUrl: "https://example.com/bg-4.jpg",
        credit: "Photo by Example",
      },
      font,
    );

    const deletedCount = dbModule.deleteAllQuoteHistory();
    expect(deletedCount).toBe(2);
    expect(dbModule.getQuoteHistory(10)).toHaveLength(0);
    expect(dbModule.getUsedQuotes().size).toBe(0);
  });

  test("supports hidden quotes and allowlist", () => {
    const hiddenAdded = dbModule.addHiddenQuote("Keep things simple.");
    expect(hiddenAdded).toBe(true);
    expect(dbModule.getHiddenQuoteSet().has("keep things simple.")).toBe(true);

    const allowSaved = dbModule.addAllowlistQuote({
      text: "Bias for action.",
      author: "Team",
      attribution: "Engineering Principle",
      sourceUrl: "",
    });
    expect(allowSaved).toBe(true);
    expect(dbModule.getAllowlistQuotes().some((entry) => entry.text === "Bias for action.")).toBe(true);

    const hiddenRemoved = dbModule.removeHiddenQuote("Keep things simple.");
    expect(hiddenRemoved).toBe(true);
    expect(dbModule.getHiddenQuoteSet().has("keep things simple.")).toBe(false);

    const allowRemoved = dbModule.removeAllowlistQuote("Bias for action.");
    expect(allowRemoved).toBe(true);
  });

  test("supports daily quote/background cache storage", () => {
    dbModule.setDailyQuoteCache("2026-02-24", [
      {
        text: "Optimize for clarity.",
        author: "Team",
        attribution: "Standup",
      },
    ]);
    dbModule.setDailyBackgroundCache("2026-02-24", [
      {
        id: "bg-cache",
        name: "Cache Background",
        imageUrl: "https://example.com/cache.jpg",
        credit: "Example",
      },
    ]);

    const quotes = dbModule.getDailyQuoteCache("2026-02-24");
    const backgrounds = dbModule.getDailyBackgroundCache("2026-02-24");
    expect(quotes?.[0]?.text).toBe("Optimize for clarity.");
    expect(backgrounds?.[0]?.id).toBe("bg-cache");
  });
});
