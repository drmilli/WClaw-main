import { describe, test, expect } from "bun:test";
import { parseMarketTitle } from "../src/market/parser.js";
import type { RawMarket } from "../src/types.js";

function makeRaw(title: string, overrides: Partial<RawMarket> = {}): RawMarket {
  return {
    conditionId: "cond-123",
    questionId: "q-123",
    title,
    slug: "test-slug",
    outcomes: ["Yes", "No"],
    outcomePrices: ["0.50", "0.50"],
    tokens: [
      { tokenId: "yes-token", outcome: "Yes", price: 0.5 },
      { tokenId: "no-token", outcome: "No", price: 0.5 },
    ],
    volume: 10000,
    endDateIso: "2026-02-18T00:00:00Z",
    active: true,
    closed: false,
    ...overrides,
  };
}

describe("parseMarketTitle — between brackets", () => {
  test("standard between format", () => {
    const raw = makeRaw("Will the highest temperature in New York City be between 32-33°F on February 16?");
    const p = parseMarketTitle(raw);
    expect(p).not.toBeNull();
    expect(p!.city).toBe("nyc");
    expect(p!.bracketType).toBe("between");
    expect(p!.bracketMin).toBe(32);
    expect(p!.bracketMax).toBe(34); // parser adds 1 for exclusive upper bound
    expect(p!.date).toBe("2026-02-16");
    expect(p!.metric).toBe("high");
  });

  test("between with different city", () => {
    const raw = makeRaw("Will the highest temperature in Chicago be between 50-51°F on February 17?");
    const p = parseMarketTitle(raw);
    expect(p).not.toBeNull();
    expect(p!.city).toBe("chicago");
    expect(p!.bracketMin).toBe(50);
    expect(p!.bracketMax).toBe(52);
  });

  test("between with no degree symbol", () => {
    const raw = makeRaw("Will the highest temperature in Miami be between 78-79 F on February 17?");
    const p = parseMarketTitle(raw);
    expect(p).not.toBeNull();
    expect(p!.city).toBe("miami");
    expect(p!.bracketMin).toBe(78);
    expect(p!.bracketMax).toBe(80);
  });

  test("wide bracket (10 degree range)", () => {
    const raw = makeRaw("Will the highest temperature in Atlanta be between 50-60°F on February 17?");
    const p = parseMarketTitle(raw);
    expect(p).not.toBeNull();
    expect(p!.bracketMin).toBe(50);
    expect(p!.bracketMax).toBe(61);
  });
});

describe("parseMarketTitle — or below brackets", () => {
  test("standard or below format", () => {
    const raw = makeRaw("Will the highest temperature in New York City be 31°F or below on February 16?");
    const p = parseMarketTitle(raw);
    expect(p).not.toBeNull();
    expect(p!.city).toBe("nyc");
    expect(p!.bracketType).toBe("below");
    expect(p!.bracketMin).toBe(-Infinity);
    expect(p!.bracketMax).toBe(32); // 31 + 1, because "31 or below" means < 32
    expect(p!.date).toBe("2026-02-16");
  });

  test("or below with different city", () => {
    const raw = makeRaw("Will the highest temperature in Seattle be 40°F or below on February 18?");
    const p = parseMarketTitle(raw);
    expect(p).not.toBeNull();
    expect(p!.city).toBe("seattle");
    expect(p!.bracketMax).toBe(41);
  });
});

describe("parseMarketTitle — or higher brackets", () => {
  test("standard or higher format", () => {
    const raw = makeRaw("Will the highest temperature in New York City be 46°F or higher on February 16?");
    const p = parseMarketTitle(raw);
    expect(p).not.toBeNull();
    expect(p!.city).toBe("nyc");
    expect(p!.bracketType).toBe("above");
    expect(p!.bracketMin).toBe(46);
    expect(p!.bracketMax).toBe(Infinity);
    expect(p!.date).toBe("2026-02-16");
  });

  test("or higher with Dallas", () => {
    const raw = makeRaw("Will the highest temperature in Dallas be 70°F or higher on February 17?");
    const p = parseMarketTitle(raw);
    expect(p).not.toBeNull();
    expect(p!.city).toBe("dallas");
    expect(p!.bracketMin).toBe(70);
  });
});

describe("parseMarketTitle — city matching", () => {
  test("matches NYC aliases", () => {
    const titles = [
      "Will the highest temperature in New York City be between 40-41°F on February 17?",
      "Will the highest temperature in NYC be between 40-41°F on February 17?",
    ];
    for (const t of titles) {
      const p = parseMarketTitle(makeRaw(t));
      expect(p).not.toBeNull();
      expect(p!.city).toBe("nyc");
    }
  });

  test("matches all 6 cities", () => {
    const cities = [
      ["New York City", "nyc"],
      ["Chicago", "chicago"],
      ["Miami", "miami"],
      ["Atlanta", "atlanta"],
      ["Seattle", "seattle"],
      ["Dallas", "dallas"],
    ];
    for (const [name, slug] of cities) {
      const raw = makeRaw(`Will the highest temperature in ${name} be between 40-41°F on February 17?`);
      const p = parseMarketTitle(raw);
      expect(p).not.toBeNull();
      expect(p!.city).toBe(slug);
    }
  });

  test("unknown city returns null", () => {
    const raw = makeRaw("Will the highest temperature in Tokyo be between 40-41°F on February 17?");
    const p = parseMarketTitle(raw);
    expect(p).toBeNull();
  });
});

describe("parseMarketTitle — date parsing", () => {
  test("parses various months", () => {
    const months = [
      ["January 5", "01-05"],
      ["February 16", "02-16"],
      ["March 1", "03-01"],
      ["December 31", "12-31"],
    ];
    for (const [monthDay, expected] of months) {
      const raw = makeRaw(`Will the highest temperature in NYC be between 40-41°F on ${monthDay}?`);
      const p = parseMarketTitle(raw);
      expect(p).not.toBeNull();
      expect(p!.date).toContain(expected);
    }
  });

  test("single digit day gets zero-padded", () => {
    const raw = makeRaw("Will the highest temperature in NYC be between 40-41°F on March 5?");
    const p = parseMarketTitle(raw);
    expect(p).not.toBeNull();
    expect(p!.date).toMatch(/\d{4}-03-05/);
  });
});

describe("parseMarketTitle — token mapping", () => {
  test("maps YES token to index 0, NO to index 1", () => {
    const raw = makeRaw("Will the highest temperature in NYC be between 40-41°F on February 17?", {
      tokens: [
        { tokenId: "yes-abc", outcome: "Yes", price: 0.14 },
        { tokenId: "no-xyz", outcome: "No", price: 0.86 },
      ],
    });
    const p = parseMarketTitle(raw);
    expect(p).not.toBeNull();
    expect(p!.yesTokenId).toBe("yes-abc");
    expect(p!.noTokenId).toBe("no-xyz");
    expect(p!.yesPrice).toBe(0.14);
    expect(p!.noPrice).toBe(0.86);
  });
});

describe("parseMarketTitle — malformed input", () => {
  test("completely unrelated title returns null", () => {
    const raw = makeRaw("Will Bitcoin hit $100K by end of year?");
    expect(parseMarketTitle(raw)).toBeNull();
  });

  test("missing temperature returns null", () => {
    const raw = makeRaw("Will the highest temperature in NYC be on February 17?");
    expect(parseMarketTitle(raw)).toBeNull();
  });
});
