import { describe, test, expect } from "bun:test";
import { calculateEdge } from "../src/engine/edge.js";
import type { ParsedMarket, EnsembleForecast, DailyForecast } from "../src/types.js";

function makeMarket(overrides: Partial<ParsedMarket> = {}): ParsedMarket {
  return {
    conditionId: "cond-1",
    title: "test",
    city: "nyc",
    date: "2026-02-17",
    metric: "high",
    bracketMin: 42,
    bracketMax: 44,
    bracketType: "between",
    yesTokenId: "yes-1",
    noTokenId: "no-1",
    yesPrice: 0.14,
    noPrice: 0.86,
    volume: 5000,
    endDateIso: "2026-02-18T00:00:00Z",
    ...overrides,
  };
}

// 20 out of 31 members predict 42-43F → model prob = 64.5%
const HIGHS = [
  ...Array(10).fill(42),
  ...Array(10).fill(43),
  ...Array(5).fill(41),
  ...Array(6).fill(44),
];

const ENSEMBLE: EnsembleForecast = {
  city: "nyc",
  fetchedAt: Date.now(),
  daily: [{ date: "2026-02-17", highs: HIGHS, lows: HIGHS.map((h) => h - 15) }],
};

describe("calculateEdge", () => {
  test("identifies YES edge when model prob > YES price", () => {
    // Model says 64.5%, market says 14 cents → edge = 50.5%
    const market = makeMarket({ yesPrice: 0.14, noPrice: 0.86 });
    const result = calculateEdge(market, ENSEMBLE);
    expect(result).not.toBeNull();
    expect(result!.side).toBe("YES");
    expect(result!.edge).toBeCloseTo(20 / 31 - 0.14, 3);
    expect(result!.modelProbability).toBeCloseTo(20 / 31, 5);
  });

  test("identifies NO edge when model prob < YES price", () => {
    // Market overprices YES at 90 cents, model says only 64.5%
    // NO edge = (1 - 0.645) - 0.10 = 0.255
    const market = makeMarket({ yesPrice: 0.90, noPrice: 0.10 });
    const result = calculateEdge(market, ENSEMBLE);
    expect(result).not.toBeNull();
    expect(result!.side).toBe("NO");
    expect(result!.edge).toBeGreaterThan(0);
  });

  test("returns null when no edge on either side", () => {
    // Market perfectly priced at model probability
    const prob = 20 / 31;
    const market = makeMarket({ yesPrice: prob, noPrice: 1 - prob });
    const result = calculateEdge(market, ENSEMBLE);
    expect(result).toBeNull();
  });

  test("returns null when date not in ensemble", () => {
    const market = makeMarket({ date: "2099-01-01" });
    const result = calculateEdge(market, ENSEMBLE);
    expect(result).toBeNull();
  });

  test("picks YES when YES edge > NO edge", () => {
    // YES hugely underpriced at 5 cents, model says 64.5%
    const market = makeMarket({ yesPrice: 0.05, noPrice: 0.95 });
    const result = calculateEdge(market, ENSEMBLE);
    expect(result!.side).toBe("YES");
  });

  test("picks NO when NO edge > YES edge", () => {
    // YES overpriced at 95 cents, model says 64.5%
    const market = makeMarket({ yesPrice: 0.95, noPrice: 0.05 });
    const result = calculateEdge(market, ENSEMBLE);
    expect(result!.side).toBe("NO");
  });
});
