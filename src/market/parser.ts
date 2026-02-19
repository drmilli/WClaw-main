import { logger } from "../logger.js";
import { CITY_ALIASES } from "../config.js";
import type { RawMarket, ParsedMarket } from "../types.js";

const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04",
  may: "05", june: "06", july: "07", august: "08",
  september: "09", october: "10", november: "11", december: "12",
  jan: "01", feb: "02", mar: "03", apr: "04",
  jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/**
 * Actual Polymarket weather market title formats:
 *
 * "Will the highest temperature in New York City be 31°F or below on February 16?"
 * "Will the highest temperature in New York City be between 32-33°F on February 16?"
 * "Will the highest temperature in New York City be 46°F or higher on February 16?"
 */

// "be X°F or below on DATE"
const RE_OR_BELOW = /highest\s+temperature\s+in\s+(.+?)\s+be\s+(\d+)\s*°?\s*F?\s+or\s+below\s+on\s+(\w+\s+\d+)/i;

// "be between X-Y°F on DATE"
const RE_BETWEEN = /highest\s+temperature\s+in\s+(.+?)\s+be\s+between\s+(\d+)\s*-\s*(\d+)\s*°?\s*F?\s+on\s+(\w+\s+\d+)/i;

// "be X°F or higher on DATE"
const RE_OR_HIGHER = /highest\s+temperature\s+in\s+(.+?)\s+be\s+(\d+)\s*°?\s*F?\s+or\s+higher\s+on\s+(\w+\s+\d+)/i;

export function parseMarketTitle(raw: RawMarket): ParsedMarket | null {
  const title = raw.title;

  // Try "between X-Y°F"
  let m = title.match(RE_BETWEEN);
  if (m) {
    const citySlug = matchCity(m[1]);
    if (!citySlug) return logUnparsed(title, "city");
    const date = parseDate(m[4]);
    if (!date) return logUnparsed(title, "date");
    return buildParsed(raw, citySlug, date, "high", "between", Number(m[2]), Number(m[3]) + 1);
  }

  // Try "X°F or below"
  m = title.match(RE_OR_BELOW);
  if (m) {
    const citySlug = matchCity(m[1]);
    if (!citySlug) return logUnparsed(title, "city");
    const date = parseDate(m[3]);
    if (!date) return logUnparsed(title, "date");
    return buildParsed(raw, citySlug, date, "high", "below", -Infinity, Number(m[2]) + 1);
  }

  // Try "X°F or higher"
  m = title.match(RE_OR_HIGHER);
  if (m) {
    const citySlug = matchCity(m[1]);
    if (!citySlug) return logUnparsed(title, "city");
    const date = parseDate(m[3]);
    if (!date) return logUnparsed(title, "date");
    return buildParsed(raw, citySlug, date, "high", "above", Number(m[2]), Infinity);
  }

  return logUnparsed(title, "no pattern matched");
}

function matchCity(raw: string): string | null {
  const normalized = raw.trim().toLowerCase();
  // Direct match
  if (CITY_ALIASES[normalized]) return CITY_ALIASES[normalized];
  // Try partial match
  for (const [alias, slug] of Object.entries(CITY_ALIASES)) {
    if (normalized.includes(alias) || alias.includes(normalized)) return slug;
  }
  return null;
}

function parseDate(raw: string): string | null {
  const parts = raw.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const monthStr = parts[0].toLowerCase();
  const day = parts[1].replace(/\D/g, "");
  const monthNum = MONTHS[monthStr];
  if (!monthNum || !day) return null;

  const now = new Date();
  let year = now.getFullYear();
  // If the market month is earlier than the current month by more than 6 months
  // it must be referring to next year (e.g. parsing a January market in December).
  const parsedMonth = Number(monthNum);
  if (parsedMonth < now.getMonth() + 1 - 6) {
    year += 1;
  }
  return `${year}-${monthNum}-${day.padStart(2, "0")}`;
}

function buildParsed(
  raw: RawMarket,
  city: string,
  date: string,
  metric: "high" | "low",
  bracketType: "above" | "below" | "between",
  bracketMin: number,
  bracketMax: number,
): ParsedMarket {
  return {
    conditionId: raw.conditionId,
    title: raw.title,
    city,
    date,
    metric,
    bracketMin,
    bracketMax,
    bracketType,
    yesTokenId: raw.tokens[0]?.tokenId ?? "",
    noTokenId: raw.tokens[1]?.tokenId ?? "",
    yesPrice: raw.tokens[0]?.price ?? 0,
    noPrice: raw.tokens[1]?.price ?? 0,
    volume: raw.volume,
    endDateIso: raw.endDateIso,
  };
}

function logUnparsed(title: string, reason: string): null {
  logger.debug({ title, reason }, "Unparseable market title");
  return null;
}

export function parseAllMarkets(raws: RawMarket[]): ParsedMarket[] {
  const parsed: ParsedMarket[] = [];
  for (const raw of raws) {
    const p = parseMarketTitle(raw);
    if (p) parsed.push(p);
  }
  logger.info({ total: raws.length, parsed: parsed.length }, "Markets parsed");
  return parsed;
}
