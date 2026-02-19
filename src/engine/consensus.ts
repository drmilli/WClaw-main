import { logger } from "../logger.js";
import type { EnsembleForecast, CityConfig } from "../types.js";
import { getModelProbability } from "../weather/probability.js";
import { getNWSHigh, fetchNWSForecast } from "../weather/nws.js";

export type ConfidenceTier = "LOCK" | "STRONG" | "SAFE" | "NEAR-SAFE" | "SKIP";

export interface ConsensusResult {
  gfsProbability: number;
  ecmwfProbability: number | null;
  nwsHigh: number | null;
  consensusProbability: number;
  confidence: ConfidenceTier;
  modelsAgreeing: number;
  kellyMultiplier: number; // 1.0 = normal, 1.5 = high confidence, 0.5 = low confidence
}

/**
 * Multi-model consensus engine.
 *
 * When 2+ models agree: increase confidence → raise Kelly multiplier
 * When models disagree: reduce confidence → lower Kelly multiplier or skip
 */
export function calculateConsensus(
  gfsEnsemble: EnsembleForecast,
  ecmwfEnsemble: EnsembleForecast | null,
  nwsHigh: number | null,
  date: string,
  metric: "high" | "low",
  bracketType: "above" | "below" | "between",
  bracketMin: number,
  bracketMax: number,
): ConsensusResult | null {
  // GFS probability (required)
  const gfsProb = getModelProbability(gfsEnsemble, date, metric, bracketType, bracketMin, bracketMax);
  if (gfsProb === null) return null;

  // ECMWF probability (optional)
  let ecmwfProb: number | null = null;
  if (ecmwfEnsemble) {
    ecmwfProb = getModelProbability(ecmwfEnsemble, date, metric, bracketType, bracketMin, bracketMax);
  }

  // NWS point forecast check (does NWS high fall in the bracket?)
  let nwsInBracket: boolean | null = null;
  if (nwsHigh !== null && metric === "high") {
    switch (bracketType) {
      case "above":
        nwsInBracket = nwsHigh >= bracketMin;
        break;
      case "below":
        nwsInBracket = nwsHigh < bracketMax;
        break;
      case "between":
        nwsInBracket = nwsHigh >= bracketMin && nwsHigh < bracketMax;
        break;
    }
  }

  // Count agreeing models
  let modelsAgreeing = 0;
  const probThreshold = 0.5; // above 50% = "likely YES"

  const gfsVote = gfsProb >= probThreshold;
  modelsAgreeing++; // GFS always counts

  if (ecmwfProb !== null) {
    const ecmwfVote = ecmwfProb >= probThreshold;
    if (ecmwfVote === gfsVote) modelsAgreeing++;
  }

  if (nwsInBracket !== null) {
    if (nwsInBracket === gfsVote) modelsAgreeing++;
  }

  // Calculate consensus probability (weighted average)
  let consensusProb: number;
  let totalWeight = 0;

  // GFS weight: 1.0
  consensusProb = gfsProb * 1.0;
  totalWeight += 1.0;

  // ECMWF weight: 1.2 (slightly more accurate)
  if (ecmwfProb !== null) {
    consensusProb += ecmwfProb * 1.2;
    totalWeight += 1.2;
  }

  consensusProb /= totalWeight;

  // Determine confidence tier and Kelly multiplier
  const totalModels = 1 + (ecmwfProb !== null ? 1 : 0) + (nwsInBracket !== null ? 1 : 0);
  const agreementRatio = modelsAgreeing / totalModels;

  let confidence: ConfidenceTier;
  let kellyMultiplier: number;

  if (totalModels >= 2 && agreementRatio === 1.0) {
    // All models agree
    confidence = "LOCK";
    kellyMultiplier = 1.5;
  } else if (totalModels >= 2 && agreementRatio >= 0.66) {
    // Majority agree
    confidence = "STRONG";
    kellyMultiplier = 1.2;
  } else if (totalModels === 1) {
    // Only GFS available
    confidence = "SAFE";
    kellyMultiplier = 1.0;
  } else if (agreementRatio >= 0.5) {
    confidence = "NEAR-SAFE";
    kellyMultiplier = 0.7;
  } else {
    // Models disagree
    confidence = "SKIP";
    kellyMultiplier = 0;
  }

  return {
    gfsProbability: gfsProb,
    ecmwfProbability: ecmwfProb,
    nwsHigh,
    consensusProbability: consensusProb,
    confidence,
    modelsAgreeing,
    kellyMultiplier,
  };
}
