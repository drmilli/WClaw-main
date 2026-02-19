import type { ParsedMarket, EnsembleForecast } from "../types.js";
import { getModelProbability } from "../weather/probability.js";

export interface EdgeResult {
  market: ParsedMarket;
  modelProbability: number;
  marketPrice: number;
  edge: number; // positive = model says YES is underpriced
  side: "YES" | "NO";
  effectivePrice: number; // price we'd pay for the side we're taking
}

/**
 * Calculate edge between model probability and market price.
 *
 * If model says YES probability > YES price → buy YES (positive edge on YES)
 * If model says YES probability < YES price → buy NO (positive edge on NO)
 */
export function calculateEdge(
  market: ParsedMarket,
  ensemble: EnsembleForecast,
): EdgeResult | null {
  const modelProb = getModelProbability(
    ensemble,
    market.date,
    market.metric,
    market.bracketType,
    market.bracketMin,
    market.bracketMax,
  );

  if (modelProb === null) return null;

  const yesPrice = market.yesPrice;
  const noPrice = market.noPrice;

  // Edge on YES side
  const yesEdge = modelProb - yesPrice;
  // Edge on NO side
  const noEdge = (1 - modelProb) - noPrice;

  // Pick the side with the better edge
  if (yesEdge >= noEdge && yesEdge > 0) {
    return {
      market,
      modelProbability: modelProb,
      marketPrice: yesPrice,
      edge: yesEdge,
      side: "YES",
      effectivePrice: yesPrice,
    };
  } else if (noEdge > 0) {
    return {
      market,
      modelProbability: 1 - modelProb,
      marketPrice: noPrice,
      edge: noEdge,
      side: "NO",
      effectivePrice: noPrice,
    };
  }

  return null;
}
