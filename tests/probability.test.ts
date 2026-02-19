import { describe, test, expect } from "bun:test";
import {
  calcBucketProbability,
  calcAboveProbability,
  calcBelowProbability,
  getModelProbability,
} from "../src/weather/probability.js";
import type { DailyForecast, EnsembleForecast } from "../src/types.js";

// Helper: create a DailyForecast with known highs
function makeForecast(highs: number[], date = "2026-02-17"): DailyForecast {
  return { date, highs, lows: highs.map((h) => h - 15) };
}

// 31 members: 10 at 41F, 10 at 42F, 10 at 43F, 1 at 44F
const MOCK_HIGHS = [
  ...Array(10).fill(41),
  ...Array(10).fill(42),
  ...Array(10).fill(43),
  ...Array(1).fill(44),
];
const FORECAST = makeForecast(MOCK_HIGHS);

describe("calcBucketProbability", () => {
  test("counts members in between bracket (inclusive min, exclusive max)", () => {
    // "between 42-43F" → bracketMin=42, bracketMax=44
    const result = calcBucketProbability(FORECAST, "high", 42, 44);
    // 42F (10) + 43F (10) = 20 out of 31
    expect(result.memberCount).toBe(20);
    expect(result.probability).toBeCloseTo(20 / 31, 5);
  });

  test("single degree bracket", () => {
    // "between 42-42F" → bracketMin=42, bracketMax=43 (parser adds 1)
    const result = calcBucketProbability(FORECAST, "high", 42, 43);
    expect(result.memberCount).toBe(10);
    expect(result.probability).toBeCloseTo(10 / 31, 5);
  });

  test("empty bracket returns 0", () => {
    const result = calcBucketProbability(FORECAST, "high", 50, 55);
    expect(result.memberCount).toBe(0);
    expect(result.probability).toBe(0);
  });

  test("bracket at exact boundary — min is inclusive", () => {
    const result = calcBucketProbability(FORECAST, "high", 44, 45);
    expect(result.memberCount).toBe(1);
  });

  test("bracket at exact boundary — max is exclusive", () => {
    const result = calcBucketProbability(FORECAST, "high", 41, 44);
    // 41F (10) + 42F (10) + 43F (10) = 30. 44F is excluded.
    expect(result.memberCount).toBe(30);
  });

  test("all members in bracket returns 1.0", () => {
    const result = calcBucketProbability(FORECAST, "high", 40, 50);
    expect(result.probability).toBe(1.0);
    expect(result.memberCount).toBe(31);
  });

  test("empty forecast returns 0", () => {
    const empty = makeForecast([]);
    const result = calcBucketProbability(empty, "high", 40, 50);
    expect(result.probability).toBe(0);
    expect(result.memberCount).toBe(0);
  });

  test("uses lows when metric is low", () => {
    // Lows are highs - 15, so 26F, 27F, 28F, 29F
    const result = calcBucketProbability(FORECAST, "low", 26, 28);
    // 26F (10) + 27F (10) = 20
    expect(result.memberCount).toBe(20);
  });
});

describe("calcAboveProbability", () => {
  test("threshold below all members → 1.0", () => {
    expect(calcAboveProbability(FORECAST, "high", 30)).toBe(1.0);
  });

  test("threshold above all members → 0.0", () => {
    expect(calcAboveProbability(FORECAST, "high", 50)).toBe(0.0);
  });

  test("threshold at exact value — inclusive (>= threshold)", () => {
    // 44F or higher: only 1 member at 44F
    expect(calcAboveProbability(FORECAST, "high", 44)).toBeCloseTo(1 / 31, 5);
  });

  test("threshold splits members", () => {
    // 42F or higher: 42F (10) + 43F (10) + 44F (1) = 21
    expect(calcAboveProbability(FORECAST, "high", 42)).toBeCloseTo(21 / 31, 5);
  });

  test("empty forecast → 0", () => {
    expect(calcAboveProbability(makeForecast([]), "high", 42)).toBe(0);
  });
});

describe("calcBelowProbability", () => {
  test("threshold above all members → 1.0", () => {
    expect(calcBelowProbability(FORECAST, "high", 50)).toBe(1.0);
  });

  test("threshold below all members → 0.0", () => {
    expect(calcBelowProbability(FORECAST, "high", 30)).toBe(0.0);
  });

  test("threshold at exact value — exclusive (< threshold, not <=)", () => {
    // below 42F: only 41F (10). Does NOT include 42F.
    expect(calcBelowProbability(FORECAST, "high", 42)).toBeCloseTo(10 / 31, 5);
  });

  test("below 44F: 41 (10) + 42 (10) + 43 (10) = 30", () => {
    expect(calcBelowProbability(FORECAST, "high", 44)).toBeCloseTo(30 / 31, 5);
  });

  test("empty forecast → 0", () => {
    expect(calcBelowProbability(makeForecast([]), "high", 42)).toBe(0);
  });
});

describe("getModelProbability", () => {
  const ensemble: EnsembleForecast = {
    city: "nyc",
    fetchedAt: Date.now(),
    daily: [FORECAST],
  };

  test("between bracket dispatches correctly", () => {
    const p = getModelProbability(ensemble, "2026-02-17", "high", "between", 42, 44);
    expect(p).toBeCloseTo(20 / 31, 5);
  });

  test("above bracket dispatches correctly", () => {
    const p = getModelProbability(ensemble, "2026-02-17", "high", "above", 43, Infinity);
    // 43F (10) + 44F (1) = 11
    expect(p).toBeCloseTo(11 / 31, 5);
  });

  test("below bracket dispatches correctly", () => {
    // For below, getModelProbability uses bracketMax as threshold
    const p = getModelProbability(ensemble, "2026-02-17", "high", "below", -Infinity, 42);
    // below 42F: 41F (10) = 10
    expect(p).toBeCloseTo(10 / 31, 5);
  });

  test("returns null for missing date", () => {
    const p = getModelProbability(ensemble, "2099-01-01", "high", "between", 42, 44);
    expect(p).toBeNull();
  });
});

describe("probability math invariants", () => {
  test("above + below at same threshold = 1.0", () => {
    const above = calcAboveProbability(FORECAST, "high", 42);
    const below = calcBelowProbability(FORECAST, "high", 42);
    expect(above + below).toBeCloseTo(1.0, 10);
  });

  test("sum of all adjacent buckets = 1.0", () => {
    // Split the full range into buckets: [40,41), [41,42), [42,43), [43,44), [44,45)
    let sum = 0;
    for (let min = 40; min <= 44; min++) {
      sum += calcBucketProbability(FORECAST, "high", min, min + 1).probability;
    }
    expect(sum).toBeCloseTo(1.0, 10);
  });
});
