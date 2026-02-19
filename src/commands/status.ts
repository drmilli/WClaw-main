/**
 * status.ts — One-shot status report for OpenClaw cron or manual checks.
 *
 * Prints current positions, P&L stats, and risk state to stdout, then exits.
 *
 * Usage: bun run src/commands/status.ts
 * Cron:  openclaw cron add --skill weatherclaw --script status --schedule "0 8 * * *"
 */

import { loadConfig } from "../config.js";
import { getOpenPositions, getStats } from "../store/db.js";
import { checkRiskLimits, initRiskState } from "../engine/risk.js";
import { getPnLSummary } from "../settlement/pnl.js";

function main() {
  const config = loadConfig();
  initRiskState();

  const openPositions = getOpenPositions();
  const stats = getStats();
  const pnl = getPnLSummary();
  const risk = checkRiskLimits(config, openPositions);

  const report = {
    mode: config.mode,
    bankroll: config.bankrollUsdc,
    openPositions: openPositions.length,
    maxPositions: config.maxOpenPositions,
    openExposure: Number(pnl.openExposure.toFixed(2)),
    totalTrades: stats.totalTrades,
    wins: stats.wins,
    losses: stats.losses,
    winRate: stats.totalTrades > 0 ? `${((stats.wins / stats.totalTrades) * 100).toFixed(1)}%` : "N/A",
    totalPnl: Number(stats.totalPnl.toFixed(2)),
    circuitBroken: risk.circuitBroken,
    consecutiveLosses: risk.consecutiveLosses,
    positions: openPositions.map((p) => ({
      city: p.city,
      date: p.date,
      side: p.side,
      bracket: p.bracketType === "between"
        ? `${p.bracketMin}-${p.bracketMax - 1}°F`
        : `${p.bracketType} ${p.bracketType === "above" ? p.bracketMin : p.bracketMax}°F`,
      entryPrice: `${(p.entryPrice * 100).toFixed(1)}¢`,
      size: `$${p.size.toFixed(2)}`,
      edge: `${(p.edge * 100).toFixed(1)}%`,
    })),
  };

  // Output as JSON for machine consumption (OpenClaw, dashboards, etc.)
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

main();
