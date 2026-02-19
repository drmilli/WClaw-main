import { getStats, getAllPositions } from "../store/db.js";

export interface PnLSummary {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  openPositions: number;
  openExposure: number;
}

export function getPnLSummary(): PnLSummary {
  const stats = getStats();
  const positions = getAllPositions();
  const open = positions.filter((p) => p.status === "open");

  return {
    totalTrades: stats.totalTrades,
    wins: stats.wins,
    losses: stats.losses,
    winRate: stats.totalTrades > 0 ? stats.wins / stats.totalTrades : 0,
    totalPnl: stats.totalPnl,
    openPositions: open.length,
    openExposure: open.reduce((sum, p) => sum + p.size, 0),
  };
}
