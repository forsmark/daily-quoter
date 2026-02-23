# Daily Quoter

A Bun + TypeScript + React app for generating and presenting an inspirational quote slide during standup.

## Features

- Bun API server + Vite React frontend
- TailwindCSS-based styling via Vite/PostCSS
- Quote suggestions from ZenQuotes (with fallback pool if unavailable)
- Background suggestions from Pexels (with bundled fallback images if unavailable)
- Generate configurable count of quote suggestions
- Avoids reuse of previously selected quotes
- Choose a background and font, then preview quote overlay
- Presentation mode uses an in-app full-viewport overlay (no browser/system fullscreen API)
- Persist chosen quote + metadata in local SQLite
- Settings page for quote count, background count, and default font
- History page for previously used quotes
- History actions: delete single entry, delete all entries, and reopen saved slides in presentation overlay
- Unit tests (Bun test) and E2E tests (Playwright)

## Configuration

Set these environment variables before running:

- `PEXELS_API_KEY` (required for Pexels backgrounds)
- `ZENQUOTES_API_KEY` (optional; used if you have one)

Optional runtime flags:

- `DISABLE_REMOTE_APIS=1` to force local fallback quotes/backgrounds (useful for tests)
- `DAILY_QUOTER_DB_PATH=/absolute/path/to/db.sqlite` to override default SQLite location

You can copy values into `.env` using `.env.example` as a template.

If `PEXELS_API_KEY` is missing or Pexels is unavailable, the app falls back to bundled local backgrounds.
If ZenQuotes is unavailable, the app falls back to local bundled quotes.

## Run

```bash
bun install
bun run dev
```

Open [http://localhost:5173](http://localhost:5173) for the UI in dev mode.
API runs on [http://localhost:3000](http://localhost:3000) and is proxied by Vite.

## Production Run

```bash
bun run build
bun run serve
```

## Testing

Run all tests:

```bash
bun run test
```

Run only unit tests:

```bash
bun run test:unit
```

Run only Playwright E2E tests:

```bash
bun run test:e2e
```

Notes:

- Playwright tests start the full app on `http://127.0.0.1:4173`
- E2E runs with `DISABLE_REMOTE_APIS=1` for deterministic fallback data
- E2E test artifacts are written to `playwright-report/` and `test-results/`

## Data

- SQLite DB: `data/daily-quoter.sqlite`
- Fallback quote source: `src/data/quotes.ts`
- Fallback background source: `src/data/backgrounds.ts` and `public/backgrounds/*.svg`

## Frontend Styling

- Tailwind source: `src/client/styles.css`
- Tailwind config: `tailwind.config.cjs`
- PostCSS config: `postcss.config.cjs`
- Vite config: `vite.config.ts`

## Test Files

- Unit tests: `tests/unit/*.test.ts`
- E2E tests: `tests/e2e/*.spec.ts`
- Playwright config: `playwright.config.ts`
