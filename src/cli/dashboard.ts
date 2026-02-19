import type { Signal, Position, AppConfig } from "../types.js";
import { getPnLSummary } from "../settlement/pnl.js";
import { getOpenPositions, getAllPositions } from "../store/db.js";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";
const WHITE = "\x1b[37m";

function pad(s: string, n: number): string {
  return s.padEnd(n).slice(0, n);
}

function rpad(s: string, n: number): string {
  return s.padStart(n).slice(0, n);
}

export function printDashboard(config: AppConfig, signals: Signal[], cycle: number): void {
  const pnl = getPnLSummary();
  const openPos = getOpenPositions();
  const allPos = getAllPositions();
  const settledPos = allPos.filter((p) => p.status === "won" || p.status === "lost");

  console.clear();

  // Header
  const modeColor = config.mode === "live" ? RED : YELLOW;
  const modeLabel = config.mode === "live" ? "LIVE" : "PAPER";
  console.log(`${BOLD}${CYAN}
  ╦ ╦┌─┐┌─┐┌┬┐┬ ┬┌─┐┬─┐╔═╗┬  ┌─┐┬ ┬
  ║║║├┤ ├─┤ │ ├─┤├┤ ├┬┘║  │  ├─┤│││
  ╚╩╝└─┘┴ ┴ ┴ ┴ ┴└─┘┴└─╚═╝┴─┘┴ ┴└┴┘${RESET}
  ${modeColor}[${modeLabel}]${RESET} ${DIM}Cycle #${cycle} | Bankroll: $${config.bankrollUsdc}${RESET}
  `);

  // Active Signals
  console.log(`${BOLD}${WHITE}── Active Signals ──${RESET}`);
  if (signals.length === 0) {
    console.log(`  ${DIM}No signals this cycle${RESET}`);
  } else {
    console.log(`  ${DIM}${pad("City", 10)} ${pad("Date", 12)} ${pad("Bracket", 18)} ${pad("Side", 5)} ${rpad("Model", 7)} ${rpad("Mkt", 7)} ${rpad("Edge", 7)} ${rpad("Size", 8)} ${pad("Conf", 10)}${RESET}`);
    for (const s of signals) {
      const bracketStr = s.market.bracketType === "between"
        ? `${s.market.bracketMin}-${s.market.bracketMax - 1}°F`
        : `${s.market.bracketType} ${s.market.bracketType === "above" ? s.market.bracketMin : s.market.bracketMax}°F`;
      const edgeColor = s.edge >= 0.15 ? GREEN : s.edge >= 0.10 ? YELLOW : WHITE;
      const confColor = s.confidence === "LOCK" ? MAGENTA : s.confidence === "STRONG" ? GREEN : YELLOW;

      console.log(
        `  ${pad(s.market.city, 10)} ${pad(s.market.date, 12)} ${pad(bracketStr, 18)} ${pad(s.side, 5)} ` +
        `${rpad((s.modelProbability * 100).toFixed(1) + "%", 7)} ` +
        `${rpad((s.marketPrice * 100).toFixed(1) + "¢", 7)} ` +
        `${edgeColor}${rpad((s.edge * 100).toFixed(1) + "%", 7)}${RESET} ` +
        `${rpad("$" + s.size.toFixed(2), 8)} ` +
        `${confColor}${pad(s.confidence, 10)}${RESET}`,
      );
    }
  }

  // Open Positions
  console.log(`\n${BOLD}${WHITE}── Open Positions (${openPos.length}/${config.maxOpenPositions}) ──${RESET}`);
  if (openPos.length === 0) {
    console.log(`  ${DIM}No open positions${RESET}`);
  } else {
    console.log(`  ${DIM}${pad("City", 10)} ${pad("Date", 12)} ${pad("Side", 5)} ${rpad("Entry", 7)} ${rpad("Size", 8)} ${rpad("Edge", 7)}${RESET}`);
    for (const p of openPos) {
      console.log(
        `  ${pad(p.city, 10)} ${pad(p.date, 12)} ${pad(p.side, 5)} ` +
        `${rpad((p.entryPrice * 100).toFixed(1) + "¢", 7)} ` +
        `${rpad("$" + p.size.toFixed(2), 8)} ` +
        `${rpad((p.edge * 100).toFixed(1) + "%", 7)}`,
      );
    }
  }

  // Recent Settlements
  const recentSettled = settledPos.slice(0, 10);
  console.log(`\n${BOLD}${WHITE}── Recent Settlements ──${RESET}`);
  if (recentSettled.length === 0) {
    console.log(`  ${DIM}No settlements yet${RESET}`);
  } else {
    for (const p of recentSettled) {
      const icon = p.status === "won" ? `${GREEN}✅` : `${RED}❌`;
      const pnlStr = (p.pnl ?? 0) >= 0 ? `${GREEN}+$${(p.pnl ?? 0).toFixed(2)}` : `${RED}-$${Math.abs(p.pnl ?? 0).toFixed(2)}`;
      console.log(`  ${icon} ${pad(p.city, 10)} ${pad(p.date, 12)} actual=${p.actualTemp}°F ${pnlStr}${RESET}`);
    }
  }

  // Summary Stats
  const winRateStr = pnl.totalTrades > 0 ? `${(pnl.winRate * 100).toFixed(1)}%` : "N/A";
  const pnlColor = pnl.totalPnl >= 0 ? GREEN : RED;
  const pnlSign = pnl.totalPnl >= 0 ? "+" : "";

  console.log(`\n${BOLD}${WHITE}── Stats ──${RESET}`);
  console.log(`  Trades: ${pnl.totalTrades} (${GREEN}${pnl.wins}W${RESET} / ${RED}${pnl.losses}L${RESET}) | Win Rate: ${winRateStr}`);
  console.log(`  P&L: ${pnlColor}${pnlSign}$${pnl.totalPnl.toFixed(2)}${RESET} | Open Exposure: $${pnl.openExposure.toFixed(2)}`);
  console.log(`  ${DIM}────────────────────────────────────────${RESET}\n`);
}
