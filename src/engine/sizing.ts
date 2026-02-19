import type { AppConfig } from "../types.js";

/**
 * Quarter-Kelly position sizing.
 *
 * Kelly formula: f* = (b*p - q) / b
 * where:
 *   b = net odds (payout - 1) = (1 - price) / price
 *   p = model probability of winning
 *   q = 1 - p
 *   f* = fraction of bankroll to bet
 *
 * We use fractional Kelly (default 0.25) for safety.
 */
export function kellySize(
  modelProbability: number,
  effectivePrice: number,
  bankroll: number,
  config: AppConfig,
): { rawKelly: number; adjustedKelly: number; size: number } {
  const p = modelProbability;
  const q = 1 - p;
  const b = (1 - effectivePrice) / effectivePrice; // net odds

  if (b <= 0) return { rawKelly: 0, adjustedKelly: 0, size: 0 };

  const rawKelly = (b * p - q) / b;

  if (rawKelly <= 0) return { rawKelly, adjustedKelly: 0, size: 0 };

  const adjustedKelly = rawKelly * config.kellyFraction;

  // Cap at max position percentage
  const cappedKelly = Math.min(adjustedKelly, config.maxPositionPct);

  const size = Math.floor(cappedKelly * bankroll * 100) / 100; // round down to cents

  return {
    rawKelly,
    adjustedKelly: cappedKelly,
    size: Math.max(size, 0),
  };
}
