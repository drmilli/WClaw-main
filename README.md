# WeatherClaw

Automated weather prediction market trading bot for Polymarket. Compares NOAA GFS/ECMWF ensemble forecast probabilities against live market prices. When models say 40% but the market says 10%, the bot buys.

**Stack:** TypeScript + Bun + SQLite
**Platform:** Polymarket (Polygon/USDC)
**Runtime:** OpenClaw (cron-triggered one-shot commands)
**Data:** Open-Meteo GFS (31 members) + ECMWF (51 members) + NWS point forecasts

---

## What's Built (you're starting here)

Everything below is working and tested:

- **Paper trading engine** — full scan → signal → trade → settle pipeline
- **Weather data** — GFS 31-member + ECMWF 51-member ensemble fetching with caching
- **Market discovery** — Polymarket Gamma API, finds ~156 active weather markets across 6 cities
- **Market parser** — 100% parse rate on all three bracket types (between, above, below)
- **Multi-model consensus** — weighted GFS + ECMWF with confidence tiers (LOCK/STRONG/SAFE/NEAR-SAFE/SKIP)
- **Quarter-Kelly position sizing** — with bankroll caps and max position limits
- **Risk controls** — circuit breaker (3 consecutive losses), max positions, min time to settlement, min liquidity
- **Settlement tracking** — Iowa State CLI API for actual observed temperatures
- **Web dashboard** — `localhost:3456` with equity curve, city heatmap, positions table, auto-refresh
- **Terminal dashboard** — color-coded ASCII output
- **SQLite storage** — signals, positions, settlements tables with WAL mode
- **OpenClaw commands** — `scan.ts`, `settle.ts`, `status.ts` one-shot CLI commands (tested, working)
- **OpenClaw skill package** — `openclaw/SKILL.md` manifest + `openclaw/scripts/*.sh` wrappers
- **Test suite** — 55 tests across probability, parser, edge, and sizing modules (`bun test`)
- **Backtest engine** — `src/engine/backtest.ts` simulates trades against historical data with per-city breakdown
- **Retry logic** — `src/utils/retry.ts` with exponential backoff on 429/5xx, wired into all 6 API callers
- **Live execution hardening** — pre-flight wallet/gas/API checks, order book-aware limit pricing
- **CLAUDE.md** — project conventions and instructions for Claude Code users

### Quick Start

```bash
bun install

# Paper mode (continuous loop for local dev)
bun run paper

# One-shot commands (what OpenClaw uses)
bun run scan      # Fetch weather → scan markets → generate signals → execute
bun run settle    # Check NWS settlements → update P&L
bun run status    # JSON report of positions + stats

# Backtest (simulate against historical data)
bun run backtest              # 14 days, all cities
bun run backtest --days 30    # 30 days
bun run backtest --city nyc   # NYC only

# Tests
bun test

# Web dashboard
open http://localhost:3456
```

### What's NOT Built Yet

These are your tasks, in priority order:

1. **Paper trading validation** — run for 5 days, get 50+ settled trades, prove win rate > 55%
2. **Live trading** — bridge USDC to Polygon, set `MODE=live`, verify real orders fill
3. **OpenClaw deployment** — provision VPS, install OpenClaw, configure cron, run 24/7 (commands are built, infrastructure is not)
4. **Strategy tuning** — dynamic edge thresholds, bias correction, ICON third model
5. **Website** — Next.js 14 + Tailwind marketing site at weatherclaw.xyz
6. **Token launch** — $WCLAW on pump.fun, token gating on dashboard and OpenClaw skill

---

## Architecture

```
src/
  index.ts                 Main while(true) loop — for LOCAL DEV only
  config.ts                City configs, env loading, aliases
  logger.ts                Pino structured logging
  types.ts                 All TypeScript interfaces

  commands/                One-shot CLI commands — what OpenClaw runs
    scan.ts                Fetch weather + scan markets + trade + exit
    settle.ts              Check settlements + update P&L + exit
    status.ts              JSON report of positions + stats + exit

  weather/
    ensemble.ts            GFS 31-member ensemble (Open-Meteo API, 6hr cache)
    ecmwf.ts               ECMWF 51-member ensemble (Open-Meteo API, 12hr cache)
    nws.ts                 NWS point forecast (api.weather.gov, 1hr cache)
    probability.ts         Bucket probability calculator

  market/
    discovery.ts           Polymarket Gamma API — finds active weather events
    parser.ts              Regex parser — market titles to structured brackets
    orderbook.ts           CLOB API — order book depth + best bid/ask
    execution.ts           Paper trade + live order placement (pre-flight checks, order book-aware pricing)

  engine/
    edge.ts                Edge = model probability - market price
    sizing.ts              Quarter-Kelly position sizing
    signals.ts             Signal generator with volume/time/edge filters
    consensus.ts           Multi-model weighted consensus (GFS 1.0x, ECMWF 1.2x)
    risk.ts                Circuit breaker, exposure limits
    backtest.ts            Historical simulation engine

  settlement/
    tracker.ts             Iowa State CLI API — actual observed temperatures
    pnl.ts                 P&L aggregation

  store/
    db.ts                  bun:sqlite wrapper (WAL mode)
    schema.ts              Table definitions (signals, positions, settlements)

  utils/
    retry.ts               fetchWithRetry — exponential backoff on 429/5xx

  cli/
    dashboard.ts           Terminal ASCII dashboard
    web.ts                 Web dashboard at localhost:3456

tests/                     Test suite (55 tests)
  probability.test.ts      Bucket probability math + boundary conditions
  parser.test.ts           Market title parsing — all bracket types, all cities
  edge.test.ts             Edge calculation + side selection
  sizing.test.ts           Kelly formula + position caps

openclaw/                  OpenClaw skill package (BUILT)
  SKILL.md                 Skill manifest with YAML frontmatter
  scripts/
    scan.sh                Shell wrapper for scan command
    settle.sh              Shell wrapper for settle command
    status.sh              Shell wrapper for status command

data/                      Created at runtime
  positions.sqlite         Trade database
  bot.log                  Execution logs
```

### Data Flow

```
Open-Meteo GFS Ensemble ──┐
Open-Meteo ECMWF Ensemble ┼── Consensus Engine ── Edge Calculator ── Kelly Sizer ── Executor
NWS Point Forecast ────────┘         │                    │                            │
                                     │                    │                            │
                              Model probability     Market price              Paper or CLOB order
                              (% of 31/51 members   (from Gamma API)         (stored in SQLite)
                               in temp bracket)                                       │
                                                                                      v
                                                          Iowa State CLI API ── Settlement Tracker ── P&L
                                                          (actual observed temp)
```

### How Edge Calculation Works

Polymarket weather markets ask: "Will the high temperature in NYC be between 42-43F on Feb 17?"

The bot answers this by counting ensemble members:
- GFS has 31 members. If 14 predict highs in the 42-43F range → model probability = 14/31 = 45.2%
- ECMWF has 51 members. If 20 predict highs in that range → model probability = 20/51 = 39.2%
- Consensus (weighted): (45.2% x 1.0 + 39.2% x 1.2) / 2.2 = 41.9%

If Polymarket prices YES at 14 cents (14% implied probability):
- Edge = 41.9% - 14.0% = **27.9%**
- This passes the 8% minimum threshold
- Quarter-Kelly sizes the bet relative to bankroll

---

## Environment Variables

Copy `.env.example` to `.env`:

```env
# --- Required ---
MODE=paper                    # "paper" for testing, "live" for real money

# --- Live mode only ---
POLYGON_PRIVATE_KEY=          # Polygon wallet private key (0x prefixed)
POLYMARKET_API_KEY=           # Auto-derived on first run if omitted
POLYMARKET_API_SECRET=        # Auto-derived on first run if omitted
POLYMARKET_API_PASSPHRASE=    # Auto-derived on first run if omitted

# --- Trading parameters ---
BANKROLL_USDC=50              # Total capital in USDC
MAX_POSITION_PCT=0.05         # Max 5% of bankroll per trade
MIN_EDGE_PCT=8                # Minimum edge to trade (percentage points)
KELLY_FRACTION=0.25           # Quarter-Kelly (conservative)
MAX_OPEN_POSITIONS=10         # Max simultaneous positions

# --- Logging ---
LOG_LEVEL=info                # debug | info | warn | error
```

---

## OpenClaw Deployment

OpenClaw is the process manager — it replaces pm2/systemd for scheduling, restarts, and secrets. It runs on a VPS ($6/month DigitalOcean droplet or similar). The bot runs as one-shot commands triggered by OpenClaw cron.

### What's already built

- `src/commands/scan.ts` — fetches weather, scans markets, generates signals, executes trades, exits
- `src/commands/settle.ts` — checks settlements against NWS data, updates P&L, exits
- `src/commands/status.ts` — outputs JSON report of positions + stats, exits
- `openclaw/SKILL.md` — skill manifest
- `openclaw/scripts/scan.sh`, `settle.sh`, `status.sh` — shell wrappers

All three commands are tested and working. `bun run scan`, `bun run settle`, `bun run status` work standalone.

### What you need to do

1. Provision a VPS (DigitalOcean NYC $6/month, or any Linux box) and install Bun + OpenClaw on it
2. Add the skill: `openclaw skill add ./openclaw`
3. Configure secrets in `~/.openclaw/openclaw.json`:
   ```json
   {
     "skills": {
       "weatherclaw": {
         "POLYGON_PRIVATE_KEY": "0x...",
         "MODE": "live",
         "BANKROLL_USDC": "300",
         "MIN_EDGE_PCT": "8",
         "KELLY_FRACTION": "0.25",
         "MAX_OPEN_POSITIONS": "10"
       }
     }
   }
   ```
4. Set up cron:
   ```bash
   openclaw cron add --skill weatherclaw --script scan --schedule "*/1 * * * *"
   openclaw cron add --skill weatherclaw --script settle --schedule "0 */1 * * *"
   openclaw cron add --skill weatherclaw --script status --schedule "0 8 * * *"
   ```
5. Publish to ClawHub when ready: `clawhub publish ./openclaw`
   - Note: ClawHub uses `metadata.clawdbot` (NOT `metadata.openclaw`)

---

## Testing

55 tests covering core logic:

```bash
bun test
```

| Test file | What it covers |
|-----------|----------------|
| `tests/probability.test.ts` | Bucket probability math, boundary conditions (inclusive min, exclusive max), empty forecasts, math invariants (above+below=1.0) |
| `tests/parser.test.ts` | All 3 bracket types, all 6 cities, date parsing, token ID mapping, malformed input handling |
| `tests/edge.test.ts` | YES vs NO side selection, null cases (no edge, missing data), edge when hugely mis-priced |
| `tests/sizing.test.ts` | Kelly formula, maxPositionPct cap, zero bankroll, rounding to cents |

---

## Backtest

Simulates what the bot would have traded over historical data:

```bash
bun run backtest                # 14 days, all 6 cities
bun run backtest --days 30      # 30-day window
bun run backtest --city nyc     # Single city
```

Uses historical GFS ensemble from Open-Meteo and actual settlement data from Iowa State CLI API. Generates synthetic brackets around the median forecast and simulates trades. Outputs: total trades, win rate, P&L, average edge, max drawdown, and per-city breakdown.

---

## Key APIs

| API | Auth | Rate Limit | Used For |
|-----|------|------------|----------|
| Open-Meteo Ensemble | None | 10K req/day | GFS + ECMWF forecast data |
| NWS api.weather.gov | User-Agent header only | Fair use | Point forecasts (tiebreaker) |
| Polymarket Gamma API | None | Generous | Market discovery + prices |
| Polymarket CLOB API | EIP-712 + HMAC (live only) | Per-account | Order placement |
| Iowa State CLI | None | Fair use | Settlement data |

All API calls use `fetchWithRetry` with exponential backoff on 429 and 5xx errors.

---

## What to Build Next

Ordered by impact on profitability. Build top-to-bottom.

### 1. Validate the Edge (FIRST — nothing else matters until this is done)

Run `bun run paper` for 5 days. Get 50+ settled trades. If win rate < 55%, debug before doing anything else.

Run `bun run backtest --days 30` to get a historical baseline. Compare backtest results to live paper results.

**Temperature rounding audit** — `src/weather/ensemble.ts:83`
- Currently rounds daily highs with `Math.round()` — verify this matches Polymarket bracket definitions
- "Between 42-43F" — does 42.5F count as in-bracket? Check Polymarket resolution rules
- A rounding bug here silently destroys win rate

**Bracket width matching** — `src/market/parser.ts:40`
- "Between 32-33F" = bracketMax is set to 34 (exclusive upper bound)
- Verify against actual Polymarket settlement for every bracket type
- Edge cases: "46F or higher" and "31F or below" — confirm boundary behavior

**Dynamic edge thresholds** — `src/engine/signals.ts:103`
- Currently uses flat `minEdge` threshold for all signals
- Change to: LOCK = 5%, STRONG = 8%, SAFE = 10%, NEAR-SAFE = 15%

### 2. Improve the Model

**Add ICON model** — `src/weather/icon.ts` (new)
- Open-Meteo supports ICON: `models=icon_seamless`
- Third model for consensus — when 3 models agree, confidence is very high
- Update `src/engine/consensus.ts`

**Time-of-day weighting** — `src/weather/probability.ts`
- NWS "daily high" is measured midnight-to-midnight local standard time
- During DST the measurement window shifts
- Filter ensemble hours to match the actual measurement window

**Bias correction** — `src/weather/bias.ts` (new)
- GFS has known warm bias in summer, cold bias in winter for certain regions
- Compare model predictions to actual settlements over 30+ days
- Apply correction: `adjusted_prob = raw_prob + city_bias[city][month]`

### 3. Improve Execution

**Position exit strategy** — `src/market/exit.ts` (new)
- Currently holds until settlement (binary: $0 or $1)
- Add ability to sell before settlement if edge reverses or position is deep in profit
- Requires selling tokens on CLOB (opposite side order)

**Multi-market hedging** — `src/engine/hedge.ts` (new)
- Temperature brackets are mutually exclusive: exactly one wins
- Buy YES on adjacent brackets to hedge
- The gopfan2 strategy does this

### 4. Website

**Marketing website** — `web/` (new Next.js 14 project)
- Next.js 14 + Tailwind CSS + Framer Motion, deploy on Vercel
- Domain: weatherclaw.xyz or weatherclaw.app (~$12/year)
- Landing page: hero, live stats, how-it-works, equity curve
- Dashboard page: token-gated, proxies bot's `/api/data` endpoint
- Docs page: strategy explainer, OpenClaw setup guide
- Design: #0a0e17 background, #06b6d4 cyan accent, JetBrains Mono, glassmorphism

### 5. Token Launch

**Token gating** — `src/middleware/token-gate.ts` (new)
- Check Solana SPL token balance before granting access
- Three tiers: Basic (100K $WCLAW = paper), Pro (1M = live), Whale (10M = all bots)
- Cache balance checks for 5 minutes

**Launch on pump.fun**
- $WCLAW token, 13 SOL budget
- Prerequisites: 2+ weeks documented live P&L, website live, Twitter/X active
- Initial buy: 5-8 SOL across 3-4 wallets, dev wallet < 5%

### 6. Additional Bots

Each bot follows the same architecture. Copy `src/` structure and adapt:

| Bot | Edge | Notes |
|-----|------|-------|
| CrossArb | Polymarket vs Kalshi price differences | Same event, different platforms |
| SportsClaw | Sharp line vs oracle lag | Pinnacle → Azuro/Overtime |
| MakerClaw | Market making spread + rebates | Needs $5K+ capital |

---

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| @polymarket/clob-client | ^3.0.0 | Polymarket order placement (live mode) |
| ethers | ^6.13.0 | EIP-712 signing for CLOB auth |
| pino | ^10.3.1 | Structured logging |
| pino-pretty | ^13.1.3 | Pretty-printed log output |

Built-in (no npm install): `bun:sqlite`, `fetch()`, `crypto.randomUUID()`, `Bun.serve()`

---

## Known Issues

- **Gamma API `tag` param is broken** — does NOT filter. Bot uses event slugs instead: `highest-temperature-in-{city}-on-{month}-{day}-{year}`
- **`@polymarket/clob-client` + Bun compatibility** — untested in live mode. May need fallback to direct REST + ethers EIP-712 signing
- **Settlement data lag** — NWS CLI reports lag 12-24 hours. Settlement checker retries hourly

---

## License

Proprietary. Token-gated access via $WCLAW.
