# Test Suite

## Unit Tests

- Location: `tests/unit`
- Runner: `bun test`
- Focus: database settings/persistence, quote quality controls (allowlist/hidden), daily cache storage, and provider behavior

Run:

```bash
bun run test:unit
```

## E2E Tests

- Location: `tests/e2e`
- Runner: Playwright
- Focus: complete UI flow (generate -> background -> font -> overlay presentation -> PNG export -> save lock), settings updates, and history actions (overlay presentation + hide + delete single/all)

Run:

```bash
bun run test:e2e
```

## Notes

- E2E starts a real server via Playwright `webServer`.
- E2E runs with `DISABLE_REMOTE_APIS=1` for deterministic fallback data.
- SQLite is isolated during E2E with `DAILY_QUOTER_DB_PATH=/tmp/daily-quoter-e2e.sqlite`.
- Optional: set `E2E_PORT` to force the Playwright webServer port.
