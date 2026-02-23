import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  deleteAllQuoteHistory,
  deleteQuoteHistoryEntry,
  getBackgroundSuggestionCount,
  getDefaultFontId,
  getQuoteHistory,
  getQuoteSuggestionCount,
  getUsedQuotes,
  saveQuoteSelection,
  setBackgroundSuggestionCount,
  setDefaultFontId,
  setQuoteSuggestionCount,
} from "./db";
import { FONT_OPTIONS } from "./data/fonts";
import { getBackgroundChoices, getQuoteSuggestions } from "./providers";
import type { Background, FontChoice, Quote } from "./types";

const DIST_DIR = resolve(process.cwd(), "dist");
const INDEX_PATH = join(DIST_DIR, "index.html");
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function clampQuoteCount(value: number): number {
  if (!Number.isFinite(value)) {
    return getQuoteSuggestionCount();
  }
  return Math.max(1, Math.min(Math.trunc(value), 20));
}

function clampBackgroundCount(value: number): number {
  if (!Number.isFinite(value)) {
    return getBackgroundSuggestionCount();
  }
  return Math.max(1, Math.min(Math.trunc(value), 24));
}

function clampHistoryLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return 100;
  }
  return Math.max(1, Math.min(Math.trunc(value), 500));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryImageStatus(status: number): boolean {
  return status === 425 || status === 429 || status === 503 || status >= 500;
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const parsedDate = Date.parse(value);
  if (Number.isNaN(parsedDate)) {
    return null;
  }

  return Math.max(0, parsedDate - Date.now());
}

function fallbackImageResponse(): Response {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#17324a"/><stop offset="1" stop-color="#5f3a20"/></linearGradient></defs><rect width="1600" height="900" fill="url(#g)"/><circle cx="300" cy="240" r="180" fill="#f4d59a" opacity="0.3"/><circle cx="1260" cy="690" r="230" fill="#8cb8d9" opacity="0.25"/></svg>`;
  return new Response(svg, {
    status: 200,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}

async function fetchImageWithRetry(imageUrl: string): Promise<Response> {
  const maxAttempts = 4;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(imageUrl, {
        headers: {
          accept: "image/avif,image/webp,image/*,*/*;q=0.8",
          "user-agent": "daily-quoter/1.0",
        },
      });

      if (response.ok) {
        return response;
      }

      if (!shouldRetryImageStatus(response.status) || attempt === maxAttempts) {
        throw new Error(`Image fetch failed with status ${response.status}`);
      }

      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      const backoffMs = retryAfterMs ?? 250 * 2 ** (attempt - 1);
      await sleep(backoffMs);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown image fetch error");
      if (attempt === maxAttempts) {
        break;
      }
      await sleep(250 * 2 ** (attempt - 1));
    }
  }

  throw lastError ?? new Error("Image fetch failed");
}

async function parseBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

function serveStatic(pathname: string): Response | null {
  if (!existsSync(INDEX_PATH)) {
    return new Response("Frontend build not found. Run `bun run build` first.", { status: 500 });
  }

  if (pathname === "/") {
    return new Response(Bun.file(INDEX_PATH));
  }

  const requestedPath = resolve(DIST_DIR, pathname.slice(1));
  if (!requestedPath.startsWith(DIST_DIR)) {
    return new Response("Forbidden", { status: 403 });
  }

  if (existsSync(requestedPath) && statSync(requestedPath).isFile()) {
    return new Response(Bun.file(requestedPath));
  }

  if (pathname.startsWith("/assets/") || pathname.startsWith("/backgrounds/")) {
    return new Response("Not found", { status: 404 });
  }

  if (!pathname.includes(".")) {
    return new Response(Bun.file(INDEX_PATH));
  }

  return new Response("Not found", { status: 404 });
}

function isValidQuote(value: unknown): value is Quote {
  if (!value || typeof value !== "object") {
    return false;
  }

  const quote = value as Quote;
  return Boolean(
    typeof quote.text === "string" &&
      quote.text.trim() &&
      typeof quote.author === "string" &&
      quote.author.trim() &&
      typeof quote.attribution === "string" &&
      quote.attribution.trim(),
  );
}

function isValidBackground(value: unknown): value is Background {
  if (!value || typeof value !== "object") {
    return false;
  }

  const background = value as Background;
  return Boolean(
    typeof background.id === "string" &&
      background.id.trim() &&
      typeof background.name === "string" &&
      background.name.trim() &&
      typeof background.imageUrl === "string" &&
      background.imageUrl.trim() &&
      typeof background.credit === "string" &&
      background.credit.trim(),
  );
}

function isValidFont(value: unknown): value is FontChoice {
  if (!value || typeof value !== "object") {
    return false;
  }

  const font = value as FontChoice;
  return Boolean(
    typeof font.id === "string" &&
      font.id.trim() &&
      typeof font.name === "string" &&
      font.name.trim() &&
      typeof font.family === "string" &&
      font.family.trim(),
  );
}

const server = Bun.serve({
  port: Number(Bun.env.PORT ?? 3000),
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/api/settings" && request.method === "GET") {
      const defaultFont = FONT_OPTIONS.find((item) => item.id === getDefaultFontId()) ?? FONT_OPTIONS[0];
      return json({
        quoteSuggestionCount: getQuoteSuggestionCount(),
        backgroundSuggestionCount: getBackgroundSuggestionCount(),
        defaultFontId: defaultFont.id,
      });
    }

    if (url.pathname === "/api/settings" && request.method === "PUT") {
      const body = await parseBody<{
        quoteSuggestionCount?: number;
        backgroundSuggestionCount?: number;
        defaultFontId?: string;
      }>(request);
      const quoteCount = clampQuoteCount(Number(body?.quoteSuggestionCount ?? getQuoteSuggestionCount()));
      const backgroundCount = clampBackgroundCount(
        Number(body?.backgroundSuggestionCount ?? getBackgroundSuggestionCount()),
      );
      const requestedDefaultFont = String(body?.defaultFontId ?? getDefaultFontId()).trim();
      const defaultFont = FONT_OPTIONS.find((item) => item.id === requestedDefaultFont) ?? FONT_OPTIONS[0];

      setQuoteSuggestionCount(quoteCount);
      setBackgroundSuggestionCount(backgroundCount);
      setDefaultFontId(defaultFont.id);

      return json({
        quoteSuggestionCount: quoteCount,
        backgroundSuggestionCount: backgroundCount,
        defaultFontId: defaultFont.id,
      });
    }

    if (url.pathname === "/api/fonts" && request.method === "GET") {
      return json({
        fonts: FONT_OPTIONS,
      });
    }

    if (url.pathname === "/api/backgrounds" && request.method === "GET") {
      const count = clampBackgroundCount(Number(url.searchParams.get("count") ?? getBackgroundSuggestionCount()));
      const data = await getBackgroundChoices(count);
      return json(data);
    }

    if (url.pathname === "/api/background-image" && request.method === "GET") {
      const sourceUrl = url.searchParams.get("src")?.trim() ?? "";
      if (!sourceUrl) {
        return fallbackImageResponse();
      }

      try {
        const parsed = new URL(sourceUrl);
        const host = parsed.hostname.toLowerCase();
        if (parsed.protocol !== "https:" || !host.endsWith("images.pexels.com")) {
          return json({ error: "Invalid image source host" }, 400);
        }

        const upstream = await fetchImageWithRetry(parsed.toString());
        const contentType = upstream.headers.get("content-type") || "image/jpeg";
        return new Response(upstream.body, {
          status: 200,
          headers: {
            "content-type": contentType,
            "cache-control": "public, max-age=86400",
          },
        });
      } catch {
        return fallbackImageResponse();
      }
    }

    if (url.pathname === "/api/quotes/generate" && request.method === "POST") {
      const body = await parseBody<{ count?: number }>(request);
      const count = clampQuoteCount(Number(body?.count ?? getQuoteSuggestionCount()));
      const data = await getQuoteSuggestions(count, getUsedQuotes());
      return json(data);
    }

    if (url.pathname === "/api/quotes/choose" && request.method === "POST") {
      const body = await parseBody<{ quote?: unknown; background?: unknown; font?: unknown }>(request);
      const quotePayload = body?.quote;
      const backgroundPayload = body?.background;
      const fontPayload = body?.font;

      if (!isValidQuote(quotePayload) || !isValidBackground(backgroundPayload) || !isValidFont(fontPayload)) {
        return json({ error: "Invalid payload" }, 400);
      }

      const selectedFont = FONT_OPTIONS.find((item) => item.id === fontPayload.id);
      if (!selectedFont) {
        return json({ error: "Unknown font" }, 400);
      }

      try {
        const saved = saveQuoteSelection(quotePayload, backgroundPayload, selectedFont);
        return json({ saved });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        if (message.includes("UNIQUE")) {
          return json({ error: "Quote has already been used. Generate new suggestions." }, 409);
        }
        return json({ error: "Failed to save quote selection" }, 500);
      }
    }

    if (url.pathname === "/api/quotes/history" && request.method === "GET") {
      const limit = clampHistoryLimit(Number(url.searchParams.get("limit") ?? 100));
      return json({ items: getQuoteHistory(limit) });
    }

    if (url.pathname === "/api/quotes/history" && request.method === "DELETE") {
      const deleted = deleteAllQuoteHistory();
      return json({ deleted });
    }

    const historyDeleteMatch = url.pathname.match(/^\/api\/quotes\/history\/(\d+)$/);
    if (historyDeleteMatch && request.method === "DELETE") {
      const id = Number.parseInt(historyDeleteMatch[1] ?? "", 10);
      if (!Number.isFinite(id) || id < 1) {
        return json({ error: "Invalid history id" }, 400);
      }

      const deleted = deleteQuoteHistoryEntry(id);
      if (!deleted) {
        return json({ error: "History entry not found" }, 404);
      }

      return json({ deleted: true });
    }

    return serveStatic(url.pathname) ?? new Response("Not found", { status: 404 });
  },
});

console.log(`Daily Quoter is running on http://localhost:${server.port}`);
