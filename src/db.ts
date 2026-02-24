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

  CREATE TABLE IF NOT EXISTS hidden_quotes (
    normalized_quote TEXT PRIMARY KEY,
    quote TEXT NOT NULL,
    created_on TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS allowlist_quotes (
    normalized_quote TEXT PRIMARY KEY,
    quote TEXT NOT NULL,
    author TEXT NOT NULL,
    attribution TEXT NOT NULL,
    source_url TEXT NOT NULL,
    created_on TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS daily_cache (
    cache_key TEXT PRIMARY KEY,
    cache_date TEXT NOT NULL,
    payload TEXT NOT NULL,
    updated_on TEXT NOT NULL
  );
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

export function getHiddenQuoteSet(): Set<string> {
  const rows = db.query("SELECT normalized_quote FROM hidden_quotes").all() as Array<{ normalized_quote: string }>;
  return new Set(rows.map((row) => row.normalized_quote));
}

export function getHiddenQuotes(): Array<{ quote: string; normalizedQuote: string; createdOn: string }> {
  const rows = db
    .query("SELECT quote, normalized_quote, created_on FROM hidden_quotes ORDER BY created_on DESC")
    .all() as Array<{ quote: string; normalized_quote: string; created_on: string }>;

  return rows.map((row) => ({
    quote: row.quote,
    normalizedQuote: row.normalized_quote,
    createdOn: row.created_on,
  }));
}

export function addHiddenQuote(quoteText: string): boolean {
  const quote = quoteText.trim();
  if (!quote) {
    return false;
  }

  const normalized = normalizeQuote(quote);
  const result = db
    .query(
      `
      INSERT INTO hidden_quotes (normalized_quote, quote, created_on)
      VALUES (?1, ?2, ?3)
      ON CONFLICT(normalized_quote) DO NOTHING
    `,
    )
    .run(normalized, quote, new Date().toISOString()) as { changes?: number };

  return Number(result.changes ?? 0) > 0;
}

export function removeHiddenQuote(quoteText: string): boolean {
  const normalized = normalizeQuote(quoteText);
  if (!normalized) {
    return false;
  }

  const result = db.query("DELETE FROM hidden_quotes WHERE normalized_quote = ?1").run(normalized) as { changes?: number };
  return Number(result.changes ?? 0) > 0;
}

export function getAllowlistQuotes(): Quote[] {
  const rows = db
    .query(
      `
      SELECT quote, author, attribution, source_url
      FROM allowlist_quotes
      ORDER BY created_on DESC
    `,
    )
    .all() as Array<{ quote: string; author: string; attribution: string; source_url: string }>;

  return rows.map((row) => ({
    text: row.quote,
    author: row.author,
    attribution: row.attribution,
    sourceUrl: row.source_url || "",
  }));
}

export function addAllowlistQuote(quote: Quote): boolean {
  const text = quote.text.trim();
  const author = quote.author.trim();
  const attribution = quote.attribution.trim();
  if (!text || !author || !attribution) {
    return false;
  }

  const normalized = normalizeQuote(text);
  const result = db
    .query(
      `
      INSERT INTO allowlist_quotes (
        normalized_quote,
        quote,
        author,
        attribution,
        source_url,
        created_on
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)
      ON CONFLICT(normalized_quote) DO UPDATE SET
        quote = excluded.quote,
        author = excluded.author,
        attribution = excluded.attribution,
        source_url = excluded.source_url
    `,
    )
    .run(normalized, text, author, attribution, quote.sourceUrl?.trim() ?? "", new Date().toISOString()) as { changes?: number };

  return Number(result.changes ?? 0) > 0;
}

export function removeAllowlistQuote(quoteText: string): boolean {
  const normalized = normalizeQuote(quoteText);
  if (!normalized) {
    return false;
  }

  const result = db.query("DELETE FROM allowlist_quotes WHERE normalized_quote = ?1").run(normalized) as { changes?: number };
  return Number(result.changes ?? 0) > 0;
}

type DailyCacheKey = "quotes" | "backgrounds";

function getDailyCache<T>(cacheKey: DailyCacheKey, cacheDate: string): T[] | null {
  const row = db
    .query("SELECT payload FROM daily_cache WHERE cache_key = ?1 AND cache_date = ?2")
    .get(cacheKey, cacheDate) as { payload: string } | null;

  if (!row) {
    return null;
  }

  try {
    const parsed = JSON.parse(row.payload) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }
    return parsed as T[];
  } catch {
    return null;
  }
}

function setDailyCache<T>(cacheKey: DailyCacheKey, cacheDate: string, values: T[]): void {
  const payload = JSON.stringify(values);
  db.query(
    `
      INSERT INTO daily_cache (cache_key, cache_date, payload, updated_on)
      VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT(cache_key) DO UPDATE SET
        cache_date = excluded.cache_date,
        payload = excluded.payload,
        updated_on = excluded.updated_on
    `,
  ).run(cacheKey, cacheDate, payload, new Date().toISOString());
}

export function getDailyQuoteCache(cacheDate: string): Quote[] | null {
  return getDailyCache<Quote>("quotes", cacheDate);
}

export function setDailyQuoteCache(cacheDate: string, quotes: Quote[]): void {
  setDailyCache("quotes", cacheDate, quotes);
}

export function getDailyBackgroundCache(cacheDate: string): Background[] | null {
  return getDailyCache<Background>("backgrounds", cacheDate);
}

export function setDailyBackgroundCache(cacheDate: string, backgrounds: Background[]): void {
  setDailyCache("backgrounds", cacheDate, backgrounds);
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
      WHERE normalized_quote NOT IN (SELECT normalized_quote FROM hidden_quotes)
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
