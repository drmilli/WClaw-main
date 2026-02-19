# WeatherClaw Roadmap

## What's Done

Everything checked off below is built, tested, and working.

```
[x] GFS 31-member ensemble fetching (6 cities, 7-day forecasts, 6hr cache)
[x] ECMWF 51-member ensemble fetching (6 cities, 7-day forecasts, 12hr cache)
[x] NWS point forecast fetching (tiebreaker signal, 1hr cache)
[x] Polymarket market discovery via Gamma API (156 markets found)
[x] Market title parser — 100% parse rate on between/above/below brackets
[x] Multi-model consensus engine (GFS weight 1.0, ECMWF weight 1.2)
[x] Confidence tiers: LOCK / STRONG / SAFE / NEAR-SAFE / SKIP
[x] Edge calculator (model probability - market price)
[x] Quarter-Kelly position sizer with bankroll caps
[x] Paper trade execution (log to SQLite, no real money)
[x] Live trade execution module (CLOB client integration, UNTESTED with real money)
[x] Live execution hardening — pre-flight wallet/gas/API checks, order book-aware limit pricing
[x] Settlement tracker via Iowa State CLI API
[x] Circuit breaker (3 consecutive losses pauses trading)
[x] SQLite storage: signals, positions, settlements tables
[x] Terminal ASCII dashboard
[x] Web dashboard at localhost:3456 (glassmorphism, equity curve, city heatmap)
[x] OpenClaw one-shot commands: scan.ts, settle.ts, status.ts
[x] OpenClaw skill package: SKILL.md + scripts/scan.sh, settle.sh, status.sh
[x] package.json scripts: paper, live, scan, settle, status, backtest, test
[x] Test suite — 55 tests: probability, parser, edge, sizing (bun test)
[x] Backtest engine — historical simulation with per-city breakdown (bun run backtest)
[x] Retry logic — fetchWithRetry with exponential backoff on 429/5xx, wired into all 6 API callers
[x] CLAUDE.md — project conventions and instructions for Claude Code users
[x] README and ROADMAP documentation
```

First paper run found 10 positions with edges from 9.6% to 66% across NYC, Chicago, Miami, and Atlanta. Total exposure: $22.83 on $50 bankroll.

---

## What's Left

### Phase 1: Paper Trading Validation (Week 1)

**Goal:** Prove the edge with 50+ settled trades and >55% win rate.

```
[x] Run backtest to get a historical baseline
    - bun run src/engine/backtest.ts --days 30
    - Result (Jan 18 – Feb 17, 2026, all 6 cities):
        Total trades:  115
        Win rate:      61.7%  ✓ EXCEEDS 55% exit criteria
        Avg edge:      20.7%
        Max drawdown:  $6.29 (per $1 normalized trades)
    - By city:
        seattle   79% win  → strongest signal
        nyc       60% win  → solid
        chicago   60% win  → solid
        miami     60% win  → solid
        atlanta   58% win  → acceptable
        dallas    53% win  → weakest, watch closely in live paper
[ ] Run bot in paper mode for 5 days straight
    - Use: bun run paper (continuous loop) or bun run scan (one-shot, every minute)
    - First 10 paper positions opened Feb 18, 2026 — awaiting settlement
[ ] Check settlements each morning
    - Use: bun run settle
    - NWS CLI reports publish 7-9 AM local time
[ ] After 50+ settled trades, analyze results by city
    - Use: bun -e "
        import { Database } from 'bun:sqlite';
        const db = new Database('data/positions.sqlite');
        db.query(\`SELECT city, COUNT(*) as total,
          SUM(CASE WHEN status='won' THEN 1 ELSE 0 END) as wins,
          ROUND(100.0 * SUM(CASE WHEN status='won' THEN 1 ELSE 0 END) / COUNT(*), 1) as win_pct,
          ROUND(SUM(COALESCE(pnl,0)), 2) as pnl
        FROM positions WHERE status IN ('won','lost') GROUP BY city\`).all()
          .forEach(r => console.log(r));
      "
[ ] Drop underperforming cities from CITIES array in src/config.ts
    - Dallas (53%) is the current candidate to cut if live paper confirms
[ ] Screenshot web dashboard daily (localhost:3456) — these become the token narrative
```

**Tuning if needed:**
- Win rate < 55%: raise `MIN_EDGE_PCT` from 8 to 12 in `.env`
- Too few signals: lower `MIN_EDGE_PCT` to 5
- Losing on a specific city: remove it from `CITIES` in `src/config.ts`

**Exit criteria:** Win rate > 55% across 50+ trades. Positive paper P&L.
**Backtest verdict:** ✅ 61.7% win rate over 30 days confirms edge exists. Proceed to live paper accumulation.

---

### Phase 2: Live Trading (Week 2)

**Goal:** Prove real money works. Start with $50-100 USDC.

```
[ ] Generate a fresh Polygon wallet for the bot
    - bun -e "const { ethers } = require('ethers'); const w = ethers.Wallet.createRandom(); console.log('Address:', w.address, 'PK:', w.privateKey);"
[ ] Bridge SOL → USDC on Polygon via app.debridge.finance
    - Also need ~0.1 MATIC for gas
[ ] Configure .env for live mode:
      MODE=live
      POLYGON_PRIVATE_KEY=0xYOUR_KEY
      BANKROLL_USDC=50
      MIN_EDGE_PCT=10
      KELLY_FRACTION=0.20
      MAX_POSITION_PCT=0.10
      MAX_OPEN_POSITIONS=5
[ ] Run: MODE=live bun run src/index.ts
[ ] Pre-flight checks will run automatically (wallet balance, gas, CLOB API)
[ ] Verify first live order fills on Polymarket
[ ] Check: actual fill price vs expected, any slippage
[ ] First live settlement — compare paper vs live results
[ ] 20+ live settled trades, positive real P&L
[ ] Screenshot equity curve for marketing
```

**Note:** The CLOB client integration is built with pre-flight checks and order book-aware pricing, but untested with real money. If `@polymarket/clob-client` doesn't work with Bun, fall back to direct REST + ethers EIP-712 signing in `src/market/execution.ts`.

**Exit criteria:** Win rate > 55% on live trades. Positive real P&L. No execution bugs.

---

### Phase 3: OpenClaw Deployment + Scale (Week 3)

**Goal:** Run 24/7 on OpenClaw on a VPS. Scale to $300 bankroll.

The one-shot commands and skill package are already built. You need a VPS as the host machine and OpenClaw as the process manager (replaces pm2/systemd). OpenClaw handles cron scheduling, restarts, and secrets — but it still needs a server to live on.

```
[ ] Provision a VPS
    - DigitalOcean NYC droplet, $6/month (cheapest — NYC for low latency to Polymarket)
    - Or any Linux box: Hetzner, Linode, AWS Lightsail, etc.
    - Install Bun: curl -fsSL https://bun.sh/install | bash
    - Clone repo, run bun install
[ ] Install OpenClaw on the VPS
    - npm install -g openclaw@latest
    - openclaw onboard --install-daemon
[ ] Add the skill:
      openclaw skill add ./openclaw
[ ] Configure secrets in ~/.openclaw/openclaw.json:
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
[ ] Set up cron schedules:
      openclaw cron add --skill weatherclaw --script scan --schedule "*/1 * * * *"
      openclaw cron add --skill weatherclaw --script settle --schedule "0 */1 * * *"
      openclaw cron add --skill weatherclaw --script status --schedule "0 8 * * *"
[ ] Verify: scan runs every minute, settle runs every hour, status runs at 8 AM
[ ] Bridge remaining capital — total $300 USDC on Polygon
[ ] Update BANKROLL_USDC in openclaw.json
[ ] Run for 1 week on OpenClaw, verify stability
[ ] 100+ settled trades total, publish results
```

**Strategy tuning (do alongside deployment):**
```
[x] Implement dynamic edge thresholds per confidence tier in src/engine/signals.ts
    - LOCK signals: 5% threshold
    - STRONG: 8%
    - SAFE: 10%
    - NEAR-SAFE: 15%
[x] Audit temperature rounding in src/weather/ensemble.ts:83
    - Math.round() confirmed correct — matches Polymarket's bracket definitions
[x] Audit bracket boundary logic in src/market/parser.ts:40
    - "Between 32-33F" → bracketMax = 34 (exclusive). Confirmed correct.
[x] Add ICON model as third consensus input (src/weather/icon.ts, new)
    - Open-Meteo: models=icon_seamless, 40 members, weight 1.0
    - Updated src/engine/consensus.ts, signals.ts, index.ts, scan.ts
```

---

### Phase 4: Website + Social Presence (Week 3-4)

**Goal:** Professional website + Twitter/X presence for the token narrative.

```
[ ] Buy domain: weatherclaw.xyz (~$12/year)
[ ] Scaffold Next.js 14 + Tailwind CSS + Framer Motion in web/ directory
[ ] Landing page:
    - Hero: "NOAA spends $1B/year on forecasting. This bot turns that into profit."
    - Live ticker showing recent trades from bot's /api/data endpoint
    - Equity curve chart (real data)
    - Stats cards: win rate, P&L, trades, positions
    - How-it-works 3-step visual
    - CTA: "Hold $WCLAW to run the bot"
[ ] Dashboard page (token-gated):
    - Proxy bot's /api/data endpoint
    - Real-time positions, equity curve, city heatmap
[ ] Docs page:
    - Strategy explainer
    - OpenClaw setup guide
    - API reference
[ ] Deploy to Vercel (free tier), point domain
[ ] Design: #0a0e17 background, #06b6d4 cyan accent, JetBrains Mono, glassmorphism
[ ] Create Twitter/X account @WeatherClaw
[ ] Daily tweet cadence:
    - Morning: yesterday's settlement results with dashboard screenshot
    - Afternoon: strategy insight or market observation
    - Weekly: thread with full week P&L breakdown
[ ] Create Telegram group, link from website
```

**Bot API hardening (before website goes live):**
```
[ ] Add CORS headers to src/cli/web.ts for website domain
[ ] Add API key auth for /api/data endpoint
[ ] Add rate limiting
```

---

### Phase 5: Token Launch (Week 5)

**Goal:** Launch $WCLAW on pump.fun. Token-gate the dashboard and OpenClaw skill.

**Prerequisites — all must be true before launching:**
- 2+ weeks of documented live trading results
- Positive P&L with real money
- Website live at weatherclaw.xyz
- OpenClaw skill running on cron
- Twitter/X account with daily P&L posts
- Telegram group with 50+ members

```
[ ] Implement token gating: src/middleware/token-gate.ts (new)
    - Check Solana SPL token balance via getTokenAccountsByOwner
    - Tiers: Basic (100K tokens = paper), Pro (1M = live), Whale (10M = all bots)
    - Cache balance checks for 5 minutes
    - Integrate into scan/settle/status commands
[ ] Test token gate: wallet with tokens = access, without = 403
[ ] Pre-launch tweets (3-5 days before): "Something is coming. NOAA meets DeFi."
[ ] Deploy token on pump.fun:
    - Name: WeatherClaw, Symbol: WCLAW
    - Initial buy: 5-8 SOL across 3-4 wallets
    - Dev wallet < 5% of supply
    - 13 SOL total budget
[ ] Launch tweet: dashboard screenshot + equity curve + contract address
[ ] Pin contract address in Telegram
[ ] Enable token gating on website dashboard
[ ] Enable token gating on OpenClaw skill
[ ] Publish skill to ClawHub: clawhub publish ./openclaw
    - Note: uses metadata.clawdbot (NOT metadata.openclaw)
[ ] Daily P&L posts continue (now with token price overlay)
[ ] First weekly buyback + burn from 5% profit share
```

**Token tiers:**

| Tier | Requirement | Access |
|------|-------------|--------|
| Free | None | Website, docs, strategy explainer |
| Basic | 100K $WCLAW | Paper mode dashboard, signals feed |
| Pro | 1M $WCLAW | Live mode, real-time signals, API access |
| Whale | 10M $WCLAW | All bots, priority execution, custom config |

---

### Phase 6: Multi-Bot Expansion (Week 6-8)

**Goal:** More bots = more utility for $WCLAW holders.

Each bot becomes a new OpenClaw skill, token-gated behind $WCLAW.

```
[ ] Build CrossArb (Polymarket vs Kalshi price differences)
[ ] Build SportsClaw (sharp line vs oracle lag — Pinnacle → Azuro/Overtime)
[ ] Build MakerClaw (market making — needs $5K+ capital)
[ ] Each bot: paper test → live test → add to $WCLAW token gate
[ ] Website shows all active bots
[ ] Leaderboard page for multi-user P&L rankings
```

**Flywheel:** More bots → more $WCLAW utility → more demand → token price → more attention → more capital → more profit share → more buyback + burn → repeat.

---

## Budget

| Phase | Cost | Source |
|-------|------|--------|
| Phase 1: Paper trading | $0 | Free |
| Phase 2: Live trading | ~$55 | 0.4 SOL |
| Phase 3: Scale capital | ~$250 | 1.6 SOL |
| Phase 4: Website | $12 | Cash |
| Phase 5: Token launch | ~$2,000 | 13 SOL |
| **Total** | **~$2,300** | **15 SOL** |

---

## Timeline

```
Week 1:  Paper trading validation (50+ trades, prove edge)
Week 2:  Live trading with $50-100 (prove real P&L)
Week 3:  OpenClaw deployment + scale capital + start website + Twitter/X
Week 4:  Website live + Telegram community building
Week 5:  Token launch on pump.fun
Week 6+: Add more bots, grow community, scale
```

---

## Risk Disclosures (include on website)

- Past performance does not guarantee future results
- Weather forecast models are not 100% accurate
- Polymarket markets may have low liquidity
- Smart contract risk exists on Polygon
- Token price can go to zero
- This is not financial advice
- Users trade at their own risk with their own capital
- WeatherClaw does not custody user funds
