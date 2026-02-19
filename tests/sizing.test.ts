import { describe, test, expect } from "bun:test";
import { kellySize } from "../src/engine/sizing.js";
import type { AppConfig } from "../src/types.js";

const DEFAULT_CONFIG: AppConfig = {
  mode: "paper",
  bankrollUsdc: 100,
  maxPositionPct: 0.05,
  minEdgePct: 8,
  kellyFraction: 0.25,
  maxOpenPositions: 10,
};

describe("kellySize", () => {
  test("positive edge → positive size", () => {
    // Model says 60% prob, buying at 10 cents (implied 10%)
    const result = kellySize(0.6, 0.10, 100, DEFAULT_CONFIG);
    expect(result.rawKelly).toBeGreaterThan(0);
    expect(result.size).toBeGreaterThan(0);
  });

  test("no edge → zero size", () => {
    // Model says 50%, market also 50%
    const result = kellySize(0.5, 0.50, 100, DEFAULT_CONFIG);
    expect(result.rawKelly).toBeLessThanOrEqual(0);
    expect(result.size).toBe(0);
  });

  test("negative edge → zero size", () => {
    // Model says 10%, buying at 90 cents
    const result = kellySize(0.1, 0.90, 100, DEFAULT_CONFIG);
    expect(result.size).toBe(0);
  });

  test("applies kelly fraction (quarter Kelly)", () => {
    const result = kellySize(0.6, 0.10, 100, DEFAULT_CONFIG);
    // adjustedKelly is min(rawKelly * fraction, maxPositionPct)
    const expected = Math.min(result.rawKelly * 0.25, DEFAULT_CONFIG.maxPositionPct);
    expect(result.adjustedKelly).toBeCloseTo(expected, 5);
  });

  test("caps at maxPositionPct", () => {
    // Huge edge should still cap at 5% of bankroll
    const result = kellySize(0.99, 0.01, 1000, DEFAULT_CONFIG);
    expect(result.size).toBeLessThanOrEqual(1000 * 0.05);
  });

  test("rounds down to cents", () => {
    const result = kellySize(0.6, 0.10, 100, DEFAULT_CONFIG);
    // Size should be a clean 2-decimal number
    expect(result.size * 100).toBe(Math.floor(result.size * 100));
  });

  test("zero bankroll → zero size", () => {
    const result = kellySize(0.6, 0.10, 0, DEFAULT_CONFIG);
    expect(result.size).toBe(0);
  });

  test("effectivePrice of 1.0 → zero size (no payout)", () => {
    const result = kellySize(0.6, 1.0, 100, DEFAULT_CONFIG);
    expect(result.size).toBe(0);
  });

  test("kelly formula math check", () => {
    // p=0.7, price=0.3 → b = (1-0.3)/0.3 = 2.333
    // rawKelly = (2.333*0.7 - 0.3) / 2.333 = (1.633 - 0.3) / 2.333 = 0.571
    const result = kellySize(0.7, 0.3, 100, DEFAULT_CONFIG);
    const b = (1 - 0.3) / 0.3;
    const expectedRaw = (b * 0.7 - 0.3) / b;
    expect(result.rawKelly).toBeCloseTo(expectedRaw, 5);
  });
});
