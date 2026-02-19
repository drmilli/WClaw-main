import { logger } from "../logger.js";
import type { AppConfig, Position } from "../types.js";
import { getAllPositions } from "../store/db.js";

export interface RiskState {
  consecutiveLosses: number;
  circuitBroken: boolean;
  totalExposure: number;
  openCount: number;
}

const MAX_CONSECUTIVE_LOSSES = 3;

let consecutiveLosses = 0;
let circuitBroken = false;

/**
 * Check if we should halt trading due to risk limits.
 */
export function checkRiskLimits(config: AppConfig, openPositions: Position[]): RiskState {
  const totalExposure = openPositions.reduce((sum, p) => sum + p.size, 0);

  return {
    consecutiveLosses,
    circuitBroken,
    totalExposure,
    openCount: openPositions.length,
  };
}

/**
 * Update risk state after a settlement.
 */
export function onSettlement(won: boolean): void {
  if (won) {
    consecutiveLosses = 0;
    if (circuitBroken) {
      circuitBroken = false;
      logger.info("Circuit breaker RESET after win");
    }
  } else {
    consecutiveLosses++;
    if (consecutiveLosses >= MAX_CONSECUTIVE_LOSSES) {
      circuitBroken = true;
      logger.warn(
        { consecutiveLosses },
        "CIRCUIT BREAKER TRIGGERED — trading paused",
      );
    }
  }
}

/**
 * Manually reset the circuit breaker.
 */
export function resetCircuitBreaker(): void {
  consecutiveLosses = 0;
  circuitBroken = false;
  logger.info("Circuit breaker manually reset");
}

/**
 * Check if a market is settling too soon (within N hours).
 */
export function isTooCloseToSettlement(endDateIso: string, minHours: number = 2): boolean {
  const endTime = new Date(endDateIso).getTime();
  const now = Date.now();
  return endTime - now < minHours * 60 * 60 * 1000;
}

/**
 * Reconstruct risk state from DB on startup.
 */
export function initRiskState(): void {
  const positions = getAllPositions();
  const settled = positions.filter((p) => p.status === "won" || p.status === "lost");

  // Count trailing consecutive losses
  consecutiveLosses = 0;
  for (const p of settled) {
    if (p.status === "lost") {
      consecutiveLosses++;
    } else {
      break;
    }
  }

  if (consecutiveLosses >= MAX_CONSECUTIVE_LOSSES) {
    circuitBroken = true;
    logger.warn({ consecutiveLosses }, "Circuit breaker active from previous session");
  }
}
