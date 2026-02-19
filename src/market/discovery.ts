import { logger } from "../logger.js";
import { fetchWithRetry } from "../utils/retry.js";
import { CITIES } from "../config.js";
import type { RawMarket, CityConfig } from "../types.js";

const GAMMA_API = "https://gamma-api.polymarket.com";

const MONTH_NAMES = [
  "", "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/**
 * Build event slugs for upcoming temperature markets.
 * Pattern: highest-temperature-in-{city}-on-{month}-{day}-{year}
 */
function buildEventSlugs(): string[] {
  const slugs: string[] = [];
  const now = new Date();

  // Check today + next 7 days
  for (let d = 0; d <= 7; d++) {
    const date = new Date(now);
    date.setDate(date.getDate() + d);
    const month = MONTH_NAMES[date.getMonth() + 1];
    const day = date.getDate();
    const year = date.getFullYear();

    for (const city of CITIES) {
      slugs.push(`highest-temperature-in-${city.polymarketSlug}-on-${month}-${day}-${year}`);
    }
  }

  return slugs;
}

/**
 * Fetch a single weather event by slug.
 */
async function fetchEvent(slug: string): Promise<GammaEventResponse | null> {
  try {
    const url = `${GAMMA_API}/events?slug=${slug}`;
    const res = await fetchWithRetry(url, {}, 2, 500);
    if (!res.ok) return null;
    const data = (await res.json()) as GammaEventResponse[];
    return data.length > 0 ? data[0] : null;
  } catch {
    return null;
  }
}

/**
 * Fetch all active weather markets from Polymarket.
 * Weather events are neg-risk events with multiple bracket markets inside.
 */
export async function fetchWeatherMarkets(): Promise<RawMarket[]> {
  const slugs = buildEventSlugs();
  logger.debug({ slugCount: slugs.length }, "Checking weather event slugs");

  const markets: RawMarket[] = [];

  // Fetch events in batches of 6 (one per city), with a delay between batches
  // to avoid hitting the unauthenticated Gamma API rate limit.
  const batchSize = 6;
  for (let i = 0; i < slugs.length; i += batchSize) {
    if (i > 0) await new Promise((r) => setTimeout(r, 200));
    const batch = slugs.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(fetchEvent));

    for (const event of results) {
      if (!event?.markets) continue;

      for (const m of event.markets) {
        if (m.closed) continue;

        const outcomePrices = typeof m.outcomePrices === "string"
          ? JSON.parse(m.outcomePrices) as string[]
          : m.outcomePrices ?? [];

        const outcomes = typeof m.outcomes === "string"
          ? JSON.parse(m.outcomes) as string[]
          : m.outcomes ?? [];

        const tokenIds = m.clobTokenIds
          ? (typeof m.clobTokenIds === "string" ? JSON.parse(m.clobTokenIds) : m.clobTokenIds) as string[]
          : [];

        const tokens = tokenIds.map((tokenId: string, idx: number) => ({
          tokenId,
          outcome: outcomes[idx] ?? (idx === 0 ? "Yes" : "No"),
          price: Number(outcomePrices[idx] ?? 0),
        }));

        markets.push({
          conditionId: m.conditionId ?? "",
          questionId: m.questionID ?? "",
          title: m.question ?? "",
          slug: event.slug ?? "",
          outcomes,
          outcomePrices,
          tokens,
          volume: Number(m.volumeNum ?? m.volume ?? 0),
          endDateIso: m.endDate ?? "",
          active: m.active !== false,
          closed: m.closed === true,
        });
      }
    }
  }

  logger.info({ count: markets.length }, "Weather markets fetched");
  return markets;
}

// --- Gamma API types ---

interface GammaEventResponse {
  id?: string;
  slug?: string;
  title?: string;
  negRisk?: boolean;
  markets?: GammaMarketResponse[];
}

interface GammaMarketResponse {
  conditionId?: string;
  questionID?: string;
  question?: string;
  slug?: string;
  outcomes?: string | string[];
  outcomePrices?: string | string[];
  clobTokenIds?: string | string[];
  volume?: string | number;
  volumeNum?: number;
  endDate?: string;
  active?: boolean;
  closed?: boolean;
}
