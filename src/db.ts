import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DEFAULT_FONT_ID } from "./data/fonts";
import type { Background, FontChoice, Quote, QuoteHistoryItem } from "./types";

const configuredDbPath = Bun.env.DAILY_QUOTER_DB_PATH?.trim();
const DB_PATH = configuredDbPath
  ? resolve(configuredDbPath)
  : resolve(process.cwd(), "data", "daily-quoter.sqlite");

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH, { create: true });

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS quote_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote TEXT NOT NULL,
    normalized_quote TEXT NOT NULL UNIQUE,
    author TEXT NOT NULL,
    attribution TEXT NOT NULL,
    background_id TEXT NOT NULL,
    selected_on TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_quote_history_selected_on ON quote_history(selected_on DESC);
`);

function ensureColumn(table: string, column: string, definition: string): void {
  const columns = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  const hasColumn = columns.some((entry) => entry.name === column);
  if (!hasColumn) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("quote_history", "background_name", "TEXT NOT NULL DEFAULT ''");
ensureColumn("quote_history", "background_image_url", "TEXT NOT NULL DEFAULT ''");
ensureColumn("quote_history", "background_credit", "TEXT NOT NULL DEFAULT ''");
ensureColumn("quote_history", "background_credit_url", "TEXT NOT NULL DEFAULT ''");
ensureColumn("quote_history", "font_id", "TEXT NOT NULL DEFAULT ''");
ensureColumn("quote_history", "font_name", "TEXT NOT NULL DEFAULT ''");
ensureColumn("quote_history", "font_family", "TEXT NOT NULL DEFAULT ''");

const DEFAULT_QUOTE_SUGGESTION_COUNT = 5;
const DEFAULT_BACKGROUND_SUGGESTION_COUNT = 8;

function normalizeQuote(text: string): string {
  return text.trim().toLowerCase();
}

export function getQuoteSuggestionCount(): number {
  const row = db
    .query("SELECT value FROM settings WHERE key = 'quote_suggestion_count'")
    .get() as { value: string } | null;

  const parsed = row ? Number.parseInt(row.value, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_QUOTE_SUGGESTION_COUNT;
  }

  return parsed;
}

export function setQuoteSuggestionCount(count: number): void {
  db.query(
    `
      INSERT INTO settings (key, value)
      VALUES ('quote_suggestion_count', ?1)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `,
  ).run(String(count));
}

export function getBackgroundSuggestionCount(): number {
  const row = db
    .query("SELECT value FROM settings WHERE key = 'background_suggestion_count'")
    .get() as { value: string } | null;

  const parsed = row ? Number.parseInt(row.value, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_BACKGROUND_SUGGESTION_COUNT;
  }

  return parsed;
}

export function setBackgroundSuggestionCount(count: number): void {
  db.query(
    `
      INSERT INTO settings (key, value)
      VALUES ('background_suggestion_count', ?1)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `,
  ).run(String(count));
}

export function getDefaultFontId(): string {
  const row = db
    .query("SELECT value FROM settings WHERE key = 'default_font_id'")
    .get() as { value: string } | null;

  const value = row?.value?.trim();
  if (!value) {
    return DEFAULT_FONT_ID;
  }

  return value;
}

export function setDefaultFontId(fontId: string): void {
  db.query(
    `
      INSERT INTO settings (key, value)
      VALUES ('default_font_id', ?1)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `,
  ).run(fontId);
}

export function getUsedQuotes(): Set<string> {
  const rows = db.query("SELECT normalized_quote FROM quote_history").all() as Array<{ normalized_quote: string }>;
  return new Set(rows.map((row) => row.normalized_quote));
}

export function saveQuoteSelection(quote: Quote, background: Background, font: FontChoice): QuoteHistoryItem {
  const selectedOn = new Date().toISOString();
  db.query(
    `
      INSERT INTO quote_history (
        quote,
        normalized_quote,
        author,
        attribution,
        background_id,
        background_name,
        background_image_url,
        background_credit,
        background_credit_url,
        font_id,
        font_name,
        font_family,
        selected_on
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
    `,
  ).run(
    quote.text,
    normalizeQuote(quote.text),
    quote.author,
    quote.attribution,
    background.id,
    background.name,
    background.imageUrl,
    background.credit,
    background.creditUrl ?? "",
    font.id,
    font.name,
    font.family,
    selectedOn,
  );

  const row = db
    .query(
      `
      SELECT
        id,
        quote,
        author,
        attribution,
        background_id,
        background_name,
        background_image_url,
        background_credit,
        background_credit_url,
        font_id,
        font_name,
        font_family,
        selected_on
      FROM quote_history
      ORDER BY id DESC
      LIMIT 1
    `,
    )
    .get() as
    | {
        id: number;
        quote: string;
        author: string;
        attribution: string;
        background_id: string;
        background_name: string;
        background_image_url: string;
        background_credit: string;
        background_credit_url: string;
        font_id: string;
        font_name: string;
        font_family: string;
        selected_on: string;
      }
    | null;

  if (!row) {
    throw new Error("Could not read saved quote.");
  }

  return {
    id: row.id,
    quote: row.quote,
    author: row.author,
    attribution: row.attribution,
    backgroundId: row.background_id,
    backgroundName: row.background_name,
    backgroundImageUrl: row.background_image_url,
    backgroundCredit: row.background_credit,
    backgroundCreditUrl: row.background_credit_url,
    fontId: row.font_id,
    fontName: row.font_name,
    fontFamily: row.font_family,
    selectedOn: row.selected_on,
  };
}

export function getQuoteHistory(limit = 60): QuoteHistoryItem[] {
  const rows = db
    .query(
      `
      SELECT
        id,
        quote,
        author,
        attribution,
        background_id,
        background_name,
        background_image_url,
        background_credit,
        background_credit_url,
        font_id,
        font_name,
        font_family,
        selected_on
      FROM quote_history
      ORDER BY selected_on DESC
      LIMIT ?1
    `,
    )
    .all(limit) as Array<{
    id: number;
    quote: string;
    author: string;
    attribution: string;
    background_id: string;
    background_name: string;
    background_image_url: string;
    background_credit: string;
    background_credit_url: string;
    font_id: string;
    font_name: string;
    font_family: string;
    selected_on: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    quote: row.quote,
    author: row.author,
    attribution: row.attribution,
    backgroundId: row.background_id,
    backgroundName: row.background_name,
    backgroundImageUrl: row.background_image_url,
    backgroundCredit: row.background_credit,
    backgroundCreditUrl: row.background_credit_url,
    fontId: row.font_id,
    fontName: row.font_name,
    fontFamily: row.font_family,
    selectedOn: row.selected_on,
  }));
}

export function deleteQuoteHistoryEntry(id: number): boolean {
  const result = db.query("DELETE FROM quote_history WHERE id = ?1").run(id) as { changes?: number };
  return Number(result.changes ?? 0) > 0;
}

export function deleteAllQuoteHistory(): number {
  const result = db.query("DELETE FROM quote_history").run() as { changes?: number };
  return Number(result.changes ?? 0);
}
