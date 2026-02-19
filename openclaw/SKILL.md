---
name: weatherclaw
version: 1.0.0
description: Automated weather prediction market trading on Polymarket
author: WeatherClaw
scripts:
  - scan
  - settle
  - status
---

# WeatherClaw

Exploits the gap between NOAA/ECMWF forecast model accuracy (85-90%) and retail Polymarket weather market pricing. GFS 31-member and ECMWF 51-member ensembles are converted into bracket probabilities, compared against live market prices, and trades are executed when the edge exceeds a configurable threshold using quarter-Kelly position sizing.

## Scripts

- **scan** — Fetch GFS + ECMWF ensemble forecasts for 6 US cities, scan all active Polymarket weather markets, generate signals where model probability diverges from market price by ≥8%, execute trades (paper or live via CLOB API). Run every 1 minute.
- **settle** — Check open positions against NWS Daily Climate Report data (Iowa State CLI API), mark positions as won/lost, update P&L and risk state (circuit breaker). Run every 1 hour.
- **status** — Output JSON report of current positions, win rate, P&L, bankroll, and risk state. Run daily at 8 AM or on demand.

## Configuration

Set these in `~/.openclaw/openclaw.json` under `skills.weatherclaw`:

| Key | Required | Default | Description |
|-----|----------|---------|-------------|
| `MODE` | No | `paper` | `paper` or `live` |
| `BANKROLL_USDC` | No | `50` | Starting bankroll in USDC |
| `MIN_EDGE_PCT` | No | `8` | Minimum edge % to trade |
| `KELLY_FRACTION` | No | `0.25` | Kelly criterion fraction (0.25 = quarter-Kelly) |
| `MAX_POSITION_PCT` | No | `0.05` | Max single position as % of bankroll |
| `MAX_OPEN_POSITIONS` | No | `10` | Max simultaneous open positions |
| `POLYGON_PRIVATE_KEY` | Yes (live) | — | Polygon wallet private key for CLOB orders |
| `POLYMARKET_API_KEY` | No | — | Pre-derived API key (auto-derived if omitted) |
| `POLYMARKET_API_SECRET` | No | — | Pre-derived API secret |
| `POLYMARKET_API_PASSPHRASE` | No | — | Pre-derived API passphrase |

## Cron Setup

```bash
openclaw cron add --skill weatherclaw --script scan --schedule "*/1 * * * *"
openclaw cron add --skill weatherclaw --script settle --schedule "0 */1 * * *"
openclaw cron add --skill weatherclaw --script status --schedule "0 8 * * *"
```

## Requirements

- [Bun](https://bun.sh) runtime (v1.0+)
- USDC on Polygon for live mode
- Internet access for Open-Meteo, Polymarket Gamma API, Polymarket CLOB API, Iowa State CLI API
