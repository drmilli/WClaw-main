# WeatherClaw — Claude Code Instructions

## What This Is

Automated weather prediction market trading bot for Polymarket. Compares NOAA GFS/ECMWF ensemble forecast probabilities against live market prices and trades the mispricing.

**Stack:** TypeScript + Bun + SQLite
**Runtime:** OpenClaw (cron-triggered one-shot commands on a VPS)

## Commands

```bash
bun run paper        # Continuous loop for local dev
bun run scan         # One-shot: fetch weather → scan markets → trade → exit
bun run settle       # One-shot: check settlements → update P&L → exit
bun run status       # One-shot: JSON report of positions + stats → exit
bun test             # Run test suite
```

## Architecture

Two execution modes that share the same modules:

1. `src/index.ts` — `while(true)` loop for local development
2. `src/commands/*.ts` — one-shot CLI commands for OpenClaw cron (production)

All modules are shared between both modes. Never duplicate logic.

## Known Bugs and Gotchas

- **Gamma API `tag` param is broken** — does NOT filter by tag. Use event slugs instead: `highest-temperature-in-{city}-on-{month}-{day}-{year}`. See `src/market/discovery.ts`.
- **`@polymarket/clob-client` + Bun** — untested in live mode. If it fails, use the direct REST + EIP-712 fallback in `src/market/execution.ts`.
- **`*/` in JSDoc comments** — Bun parses `*/` inside `/** */` block comments as end-of-comment. Use `//` line comments for any text containing cron expressions like `*/1 * * * *`.
- **Open-Meteo rate limits** — 10K requests/day. The ensemble fetcher adds 200ms delay between cities to avoid 429s. Don't parallelize city fetches.
- **NWS API requires User-Agent** — `api.weather.gov` returns 403 without a User-Agent header. See `src/weather/nws.ts`.
- **Settlement data lag** — Iowa State CLI reports lag 12-24 hours after the day ends. The settle command retries hourly, this is expected.

## Conventions

- **No classes.** Everything is functions + plain objects.
- **No external HTTP frameworks.** Web dashboard uses `Bun.serve()` directly.
- **SQLite via `bun:sqlite`** — WAL mode, lazy-initialized singleton in `src/store/db.ts`.
- **Pino for logging** — structured JSON logs. Use `logger.info({ key: value }, "message")` format.
- **IDs** — `crypto.randomUUID()` for position and signal IDs.
- **Temperature units** — all internal temps are Fahrenheit. Ensemble data arrives in Celsius and is converted in `ensemble.ts` and `ecmwf.ts`.
- **Bracket convention** — `bracketMin` is inclusive, `bracketMax` is exclusive. "Between 42-43F" → `bracketMin=42, bracketMax=44`.
- **Market price convention** — prices are 0-1 decimals (not cents). 14 cents = 0.14.

## Critical Paths (where bugs destroy profit)

1. **`src/weather/probability.ts`** — bucket probability calculation. If this miscounts ensemble members, every edge calculation is wrong.
2. **`src/market/parser.ts`** — bracket parsing from market titles. If brackets are wrong, the bot bets on the wrong temperature ranges.
3. **`src/weather/ensemble.ts:83`** — `Math.round()` for daily highs. Must match how Polymarket defines bracket boundaries.
4. **`src/engine/consensus.ts`** — model weighting. GFS weight 1.0, ECMWF weight 1.2. Wrong weights = wrong confidence.

## File Layout

```
src/
  index.ts              Main loop (local dev only)
  commands/             One-shot commands (OpenClaw production)
  weather/              Forecast data fetching + probability
  market/               Polymarket discovery, parsing, execution
  engine/               Edge, sizing, consensus, risk, signals
  settlement/           Settlement tracking + P&L
  store/                SQLite database
  cli/                  Terminal + web dashboards
openclaw/               OpenClaw skill package (SKILL.md + scripts/)
tests/                  Test suite (bun test)
data/                   Runtime data (gitignored)
```

## OpenClaw

OpenClaw is the production process manager. It runs on a VPS and triggers the one-shot commands via cron.

- Skill manifest: `openclaw/SKILL.md`
- Shell wrappers: `openclaw/scripts/*.sh`
- Secrets: `~/.openclaw/openclaw.json` (never in repo)
- ClawHub publishing uses `metadata.clawdbot` (NOT `metadata.openclaw`)

## Environment

- `.env` for local dev (gitignored)
- `~/.openclaw/openclaw.json` for production secrets
- `src/config.ts` reads from `process.env` — both sources work transparently

## Cities

6 cities tracked: NYC, Chicago, Miami, Atlanta, Seattle, Dallas. Config in `src/config.ts`. Each has: lat/lon, NWS grid coordinates, Iowa State station ID, Polymarket slug.

## APIs

| API | Auth | Notes |
|-----|------|-------|
| Open-Meteo | None | GFS + ECMWF ensembles. 10K req/day limit. |
| NWS | User-Agent | Point forecasts. Fair use. |
| Gamma API | None | Market discovery. `tag` param broken — use slugs. |
| CLOB API | EIP-712 + HMAC | Live orders only. Derives keys from private key on first run. |
| Iowa State CLI | None | Settlement data. 12-24hr lag. |
