import { BACKGROUNDS as FALLBACK_BACKGROUNDS } from "./data/backgrounds";
import { QUOTES as FALLBACK_QUOTES } from "./data/quotes";
import {
  getAllowlistQuotes,
  getDailyBackgroundCache,
  getDailyQuoteCache,
  getHiddenQuoteSet,
  setDailyBackgroundCache,
  setDailyQuoteCache,
} from "./db";
import type { Background, Quote } from "./types";

const ZENQUOTES_ENDPOINT = "https://zenquotes.io/api/quotes";
const ZENQUOTES_BASE_URL = "https://zenquotes.io";
const PEXELS_ENDPOINT = "https://api.pexels.com/v1/search";
const PEXELS_BASE_URL = "https://www.pexels.com";
const BACKGROUND_CACHE_TTL_MS = 1000 * 60 * 30;
const PEXELS_THEME_QUERIES = [
  "misty mountain sunrise",
  "forest trail cinematic",
  "ocean horizon dawn",
  "desert dunes minimal",
  "northern lights landscape",
  "waterfall long exposure",
  "calm lake reflection",
  "dramatic clouds sky",
  "snowy peaks wide",
  "rolling hills countryside",
  "autumn forest path",
  "night city skyline",
  "coastal cliffs aerial",
  "minimal abstract texture",
];
const RECENT_BACKGROUND_MEMORY = 180;
const PEXELS_MAX_RETRIES = 4;
const DISABLE_REMOTE_APIS = Bun.env.DISABLE_REMOTE_APIS === "1";

type QuoteSource = "zenquotes" | "fallback" | "cache";
type BackgroundSource = "pexels" | "fallback" | "cache";

type ZenQuote = {
  q?: string;
  a?: string;
  h?: string;
};

type PexelsPhoto = {
  id: number;
  alt?: string;
  photographer?: string;
  photographer_url?: string;
  url?: string;
  src?: {
    landscape?: string;
    large2x?: string;
    large?: string;
    original?: string;
  };
};

type PexelsSearchResponse = {
  photos?: PexelsPhoto[];
};

let backgroundCache: { expiresAt: number; backgrounds: Background[] } | null = null;
let recentBackgroundIds: string[] = [];
let dailyCacheWarmPromise: Promise<void> | null = null;

function normalizeQuote(text: string): string {
  return text.trim().toLowerCase();
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function sanitizeQuote(raw: ZenQuote): Quote | null {
  const text = typeof raw.q === "string" ? raw.q.trim().replace(/^"+|"+$/g, "") : "";
  if (!text) {
    return null;
  }

  const author = typeof raw.a === "string" && raw.a.trim() ? raw.a.trim() : "Unknown";

  return {
    text,
    author,
    attribution: "ZenQuotes",
    sourceUrl: ZENQUOTES_BASE_URL,
  };
}

function pickUnusedQuotes(
  pool: Quote[],
  used: Set<string>,
  blocked: Set<string>,
  count: number,
  preferred: Set<string> = new Set(),
): Quote[] {
  const seen = new Set<string>();
  const uniqueUnused = pool.filter((quote) => {
    const normalized = normalizeQuote(quote.text);
    if (!normalized || used.has(normalized) || blocked.has(normalized) || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });

  const preferredQuotes = uniqueUnused.filter((quote) => preferred.has(normalizeQuote(quote.text)));
  const remainingQuotes = uniqueUnused.filter((quote) => !preferred.has(normalizeQuote(quote.text)));

  return [...shuffle(preferredQuotes), ...shuffle(remainingQuotes)].slice(0, count);
}

function uniqueQuotes(pool: Quote[]): Quote[] {
  const seen = new Set<string>();
  const unique: Quote[] = [];

  for (const quote of pool) {
    const normalized = normalizeQuote(quote.text);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push({
      text: quote.text.trim(),
      author: quote.author.trim(),
      attribution: quote.attribution.trim(),
      sourceUrl: quote.sourceUrl?.trim() ?? "",
    });
  }

  return unique;
}

function buildQuotePool(primary: Quote[], allowlist: Quote[]): Quote[] {
  return uniqueQuotes([...allowlist, ...primary]);
}

async function fetchZenQuotes(): Promise<Quote[]> {
  const url = new URL(ZENQUOTES_ENDPOINT);
  const apiKey = Bun.env.ZENQUOTES_API_KEY?.trim();
  if (apiKey) {
    url.searchParams.set("apikey", apiKey);
  }

  const response = await fetch(url.toString(), {
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`ZenQuotes request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) {
    throw new Error("ZenQuotes response was not an array.");
  }

  if (payload.length > 0 && typeof payload[0] === "object" && payload[0] !== null && "error" in payload[0]) {
    throw new Error("ZenQuotes rate limit or API error.");
  }

  const quotes = payload
    .map((entry) => sanitizeQuote(entry as ZenQuote))
    .filter((entry): entry is Quote => entry !== null);

  if (quotes.length === 0) {
    throw new Error("ZenQuotes returned no usable quotes.");
  }

  return quotes;
}

function fallbackQuotes(
  count: number,
  used: Set<string>,
  blocked: Set<string>,
  allowlist: Quote[],
  preferred: Set<string>,
): Quote[] {
  const fallbackPool = FALLBACK_QUOTES.map((quote) => ({
    ...quote,
    sourceUrl: quote.sourceUrl ?? "",
  }));
  return pickUnusedQuotes(buildQuotePool(fallbackPool, allowlist), used, blocked, count, preferred);
}

export async function getQuoteSuggestions(count: number, used: Set<string>): Promise<{
  quotes: Quote[];
  exhausted: boolean;
  source: QuoteSource;
  notice?: string;
}> {
  const blocked = getHiddenQuoteSet();
  const allowlist = getAllowlistQuotes();
  const preferred = new Set(allowlist.map((quote) => normalizeQuote(quote.text)));
  const cacheDate = todayKey();
  const cachedQuotes = getDailyQuoteCache(cacheDate);
  if (cachedQuotes && cachedQuotes.length > 0) {
    const fromCache = pickUnusedQuotes(buildQuotePool(cachedQuotes, allowlist), used, blocked, count, preferred);
    if (fromCache.length > 0) {
      return {
        quotes: fromCache,
        exhausted: false,
        source: "cache",
        notice: "Serving today's pre-fetched quote cache.",
      };
    }
  }

  if (DISABLE_REMOTE_APIS) {
    const fallback = fallbackQuotes(count, used, blocked, allowlist, preferred);
    return {
      quotes: fallback,
      exhausted: fallback.length === 0,
      source: "fallback",
      notice: "Remote APIs disabled. Serving local fallback quotes.",
    };
  }

  try {
    const zenQuotes = await fetchZenQuotes();
    const pool = buildQuotePool(zenQuotes, allowlist);
    setDailyQuoteCache(cacheDate, pool);
    const picked = pickUnusedQuotes(pool, used, blocked, count, preferred);

    if (picked.length > 0) {
      return {
        quotes: picked,
        exhausted: false,
        source: "zenquotes",
      };
    }

    const fallback = fallbackQuotes(count, used, blocked, allowlist, preferred);
    return {
      quotes: fallback,
      exhausted: fallback.length === 0,
      source: fallback.length > 0 ? "fallback" : "zenquotes",
      notice:
        fallback.length > 0
          ? "ZenQuotes returned previously used items. Serving local fallback quotes to complete this run."
          : "No unused quotes available from ZenQuotes or fallback pool.",
    };
  } catch {
    const fallback = fallbackQuotes(count, used, blocked, allowlist, preferred);
    return {
      quotes: fallback,
      exhausted: fallback.length === 0,
      source: "fallback",
      notice:
        fallback.length > 0
          ? "ZenQuotes unavailable right now. Serving local fallback quotes for this run."
          : "ZenQuotes unavailable and fallback pool exhausted.",
    };
  }
}

function mapPexelsPhoto(photo: PexelsPhoto): Background | null {
  const pexelsImageUrl =
    photo.src?.landscape?.trim() ||
    photo.src?.large2x?.trim() ||
    photo.src?.large?.trim() ||
    photo.src?.original?.trim() ||
    "";

  if (!pexelsImageUrl) {
    return null;
  }

  const photographer = photo.photographer?.trim() || "Unknown photographer";
  const creditUrl = photo.url?.trim() || photo.photographer_url?.trim() || PEXELS_BASE_URL;

  return {
    id: `pexels-${photo.id}`,
    name: photo.alt?.trim() || `Pexels #${photo.id}`,
    // Proxy through server to reduce direct-browser throttling/425 responses from image CDN.
    imageUrl: `/api/background-image?src=${encodeURIComponent(pexelsImageUrl)}`,
    credit: `Photo by ${photographer} on Pexels`,
    creditUrl,
  };
}

function fallbackBackgrounds(count: number): Background[] {
  return shuffle(FALLBACK_BACKGROUNDS).slice(0, Math.min(count, FALLBACK_BACKGROUNDS.length));
}

function pickVariedBackgrounds(pool: Background[], count: number): Background[] {
  const recentSet = new Set(recentBackgroundIds);
  const fresh = pool.filter((item) => !recentSet.has(item.id));
  const merged = [...fresh, ...pool.filter((item) => !fresh.some((entry) => entry.id === item.id))];
  const picked = merged.slice(0, Math.min(count, merged.length));

  for (const item of picked) {
    recentBackgroundIds.push(item.id);
  }

  if (recentBackgroundIds.length > RECENT_BACKGROUND_MEMORY) {
    recentBackgroundIds = recentBackgroundIds.slice(recentBackgroundIds.length - RECENT_BACKGROUND_MEMORY);
  }

  return picked;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryPexelsStatus(status: number): boolean {
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

  const date = Date.parse(value);
  if (Number.isNaN(date)) {
    return null;
  }

  return Math.max(0, date - Date.now());
}

async function fetchPexelsWithRetry(url: string, apiKey: string): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= PEXELS_MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: apiKey,
          accept: "application/json",
        },
      });

      if (response.ok) {
        return response;
      }

      if (!shouldRetryPexelsStatus(response.status) || attempt === PEXELS_MAX_RETRIES) {
        throw new Error(`Pexels request failed with status ${response.status}`);
      }

      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      const backoffMs = retryAfterMs ?? 250 * 2 ** (attempt - 1) + randomInt(70, 250);
      await sleep(backoffMs);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown Pexels request failure");
      if (attempt === PEXELS_MAX_RETRIES) {
        break;
      }
      await sleep(250 * 2 ** (attempt - 1) + randomInt(70, 250));
    }
  }

  throw lastError ?? new Error("Pexels request failed.");
}

async function fetchPexelsQueryBatch(apiKey: string, query: string, count: number): Promise<Background[]> {
  const url = new URL(PEXELS_ENDPOINT);
  url.searchParams.set("query", query);
  url.searchParams.set("orientation", "landscape");
  url.searchParams.set("size", "large");
  url.searchParams.set("per_page", String(Math.max(10, Math.min(60, count * 2))));
  url.searchParams.set("page", String(randomInt(1, 80)));

  const response = await fetchPexelsWithRetry(url.toString(), apiKey);

  const payload = (await response.json()) as PexelsSearchResponse;
  const photos = Array.isArray(payload.photos) ? payload.photos : [];

  return photos
    .map((photo) => mapPexelsPhoto(photo))
    .filter((background): background is Background => background !== null);
}

async function fetchPexelsBackgrounds(count: number): Promise<Background[]> {
  const apiKey = Bun.env.PEXELS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("PEXELS_API_KEY is missing");
  }

  const cached = backgroundCache;
  if (cached && cached.expiresAt > Date.now() && cached.backgrounds.length >= count) {
    return pickVariedBackgrounds(cached.backgrounds, count);
  }

  const queryCount = Math.min(4, Math.max(2, Math.ceil(count / 4) + 1));
  const selectedQueries = shuffle(PEXELS_THEME_QUERIES).slice(0, queryCount);
  const merged: Background[] = [];

  for (const query of selectedQueries) {
    try {
      const batch = await fetchPexelsQueryBatch(apiKey, query, count);
      merged.push(...batch);
    } catch {
      // Keep going; other query themes may still succeed.
    }
    await sleep(randomInt(120, 320));
  }

  if (merged.length === 0) {
    throw new Error("Pexels returned no usable photos.");
  }

  const unique = Array.from(new Map(merged.map((item) => [item.id, item])).values());
  const pool = shuffle(unique);

  backgroundCache = {
    expiresAt: Date.now() + BACKGROUND_CACHE_TTL_MS,
    backgrounds: pool,
  };

  return pickVariedBackgrounds(pool, count);
}

export async function getBackgroundChoices(count: number): Promise<{
  backgrounds: Background[];
  source: BackgroundSource;
  notice?: string;
}> {
  const cacheDate = todayKey();
  const dailyCached = getDailyBackgroundCache(cacheDate);
  if (dailyCached && dailyCached.length >= count) {
    return {
      backgrounds: pickVariedBackgrounds(shuffle(dailyCached), count),
      source: "cache",
      notice: "Serving today's pre-fetched background cache.",
    };
  }

  if (DISABLE_REMOTE_APIS) {
    return {
      backgrounds: fallbackBackgrounds(count),
      source: "fallback",
      notice: "Remote APIs disabled. Serving bundled fallback backgrounds.",
    };
  }

  try {
    const backgrounds = await fetchPexelsBackgrounds(count);
    setDailyBackgroundCache(cacheDate, backgrounds);
    return {
      backgrounds,
      source: "pexels",
    };
  } catch {
    return {
      backgrounds: fallbackBackgrounds(count),
      source: "fallback",
      notice:
        "Pexels unavailable or API key missing. Serving bundled fallback backgrounds for this run.",
    };
  }
}

export async function warmDailyCache(quoteCount: number, backgroundCount: number): Promise<void> {
  if (DISABLE_REMOTE_APIS) {
    return;
  }

  if (dailyCacheWarmPromise) {
    await dailyCacheWarmPromise;
    return;
  }

  const cacheDate = todayKey();
  dailyCacheWarmPromise = (async () => {
    const quoteCache = getDailyQuoteCache(cacheDate);
    if (!quoteCache || quoteCache.length < quoteCount) {
      try {
        const zenQuotes = await fetchZenQuotes();
        setDailyQuoteCache(cacheDate, buildQuotePool(zenQuotes, getAllowlistQuotes()));
      } catch {
        // Best-effort warmup; runtime requests keep fallback behavior.
      }
    }

    const backgroundCacheForDay = getDailyBackgroundCache(cacheDate);
    if (!backgroundCacheForDay || backgroundCacheForDay.length < backgroundCount) {
      try {
        const backgrounds = await fetchPexelsBackgrounds(backgroundCount);
        setDailyBackgroundCache(cacheDate, backgrounds);
      } catch {
        // Best-effort warmup; runtime requests keep fallback behavior.
      }
    }
  })();

  try {
    await dailyCacheWarmPromise;
  } finally {
    dailyCacheWarmPromise = null;
  }
}
