import type { DailyForecast, BucketProbability, EnsembleForecast } from "../types.js";

/**
 * Calculate probability that a temperature falls within a bracket.
 * Supports variable bracket widths to match Polymarket formats.
 */
export function calcBucketProbability(
  forecast: DailyForecast,
  metric: "high" | "low",
  bracketMin: number,
  bracketMax: number,
): BucketProbability {
  const temps = metric === "high" ? forecast.highs : forecast.lows;
  const total = temps.length;
  if (total === 0) {
    return {
      city: "",
      date: forecast.date,
      metric,
      bracketMin,
      bracketMax,
      probability: 0,
      memberCount: 0,
    };
  }

  const inBucket = temps.filter((t) => t >= bracketMin && t < bracketMax).length;

  return {
    city: "",
    date: forecast.date,
    metric,
    bracketMin,
    bracketMax,
    probability: inBucket / total,
    memberCount: inBucket,
  };
}

/**
 * Calculate probability for "above X" bracket (X or higher).
 */
export function calcAboveProbability(
  forecast: DailyForecast,
  metric: "high" | "low",
  threshold: number,
): number {
  const temps = metric === "high" ? forecast.highs : forecast.lows;
  if (temps.length === 0) return 0;
  return temps.filter((t) => t >= threshold).length / temps.length;
}

/**
 * Calculate probability for "below X" bracket (under X).
 */
export function calcBelowProbability(
  forecast: DailyForecast,
  metric: "high" | "low",
  threshold: number,
): number {
  const temps = metric === "high" ? forecast.highs : forecast.lows;
  if (temps.length === 0) return 0;
  return temps.filter((t) => t < threshold).length / temps.length;
}

/**
 * Get model probability for a parsed market bracket.
 */
export function getModelProbability(
  ensemble: EnsembleForecast,
  date: string,
  metric: "high" | "low",
  bracketType: "above" | "below" | "between",
  bracketMin: number,
  bracketMax: number,
): number | null {
  const day = ensemble.daily.find((d) => d.date === date);
  if (!day) return null;

  switch (bracketType) {
    case "above":
      return calcAboveProbability(day, metric, bracketMin);
    case "below":
      return calcBelowProbability(day, metric, bracketMax);
    case "between":
      return calcBucketProbability(day, metric, bracketMin, bracketMax).probability;
  }
}
