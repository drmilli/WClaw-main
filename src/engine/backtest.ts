// backtest.ts — Simulate trades against historical data.
//
// Fetches past ensemble forecasts from Open-Meteo's historical API,
// fetches actual settlement data from Iowa State CLI,
// and simulates what the bot would have traded.
//
// Usage: bun run src/engine/backtest.ts [--days 30] [--city nyc]

import { logger } from "../logger.js";
import { fetchWithRetry } from "../utils/retry.js";
import { loadConfig, CITIES } from "../config.js";
import { calcBucketProbability, calcAboveProbability, calcBelowProbability } from "../weather/probability.js";
import type { CityConfig, DailyForecast, AppConfig } from "../types.js";

interface BacktestTrade {
  city: string;
  date: string;
  bracketType: "above" | "below" | "between";
  bracketMin: number;
  bracketMax: number;
  side: "YES" | "NO";
  modelProb: number;
  entryPrice: number;
  edge: number;
  actualTemp: number;
  won: boolean;
  pnl: number;
}

interface BacktestResult {
  trades: BacktestTrade[];
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgEdge: number;
  maxDrawdown: number;
  byCity: Record<string, { trades: number; wins: number; pnl: number; winRate: number }>;
}

function celsiusToFahrenheit(c: number): number {
  return c * 9 / 5 + 32;
}

// Fetch historical ensemble data from Open-Meteo
async function fetchHistoricalEnsemble(
  city: CityConfig,
  startDate: string,
  endDate: string,
): Promise<DailyForecast[]> {
  const url = new URL("https://ensemble-api.open-meteo.com/v1/ensemble");
  url.searchParams.set("latitude", String(city.lat));
  url.searchParams.set("longitude", String(city.lon));
  url.searchParams.set("hourly", "temperature_2m");
  url.searchParams.set("models", "gfs_seamless");
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);
  url.searchParams.set("temperature_unit", "celsius");

  const res = await fetchWithRetry(url.toString());
  if (!res.ok) {
    logger.error({ city: city.name, status: res.status }, "Historical ensemble fetch failed");
    return [];
  }

  const data = await res.json() as any;
  const hourly = data.hourly;
  if (!hourly?.time) return [];

  const memberKeys: string[] = [];
  for (const key of Object.keys(hourly)) {
    if (key === "temperature_2m" || key.startsWith("temperature_2m_member")) {
      memberKeys.push(key);
    }
  }

  const byDate = new Map<string, number[][]>();
  for (let i = 0; i < hourly.time.length; i++) {
    const date = hourly.time[i].slice(0, 10);
    if (!byDate.has(date)) {
      byDate.set(date, memberKeys.map(() => []));
    }
    const members = byDate.get(date)!;
    for (let m = 0; m < memberKeys.length; m++) {
      const val = hourly[memberKeys[m]][i];
      if (val != null) members[m].push(celsiusToFahrenheit(val));
    }
  }

  const daily: DailyForecast[] = [];
  for (const [date, members] of byDate) {
    const highs: number[] = [];
    const lows: number[] = [];
    for (const temps of members) {
      if (temps.length === 0) continue;
      highs.push(Math.round(Math.max(...temps)));
      lows.push(Math.round(Math.min(...temps)));
    }
    if (highs.length > 0) daily.push({ date, highs, lows });
  }

  return daily;
}

// Fetch actual temperatures from Iowa State CLI
async function fetchActualTemps(
  station: string,
  year: number,
): Promise<Map<string, number>> {
  const url = `https://mesonet.agron.iastate.edu/json/cli.py?station=${station}&year=${year}`;
  const res = await fetchWithRetry(url, {}, 2, 2000);
  if (!res.ok) return new Map();

  const data = await res.json() as any;
  const temps = new Map<string, number>();
  if (data.results) {
    for (const r of data.results) {
      temps.set(r.valid, r.high);
    }
  }
  return temps;
}

// Simulate bracket markets for a city+date (since we can't fetch historical prices,
// we generate synthetic brackets matching Polymarket's format)
function generateBrackets(baseTemp: number): Array<{
  bracketType: "above" | "below" | "between";
  bracketMin: number;
  bracketMax: number;
  syntheticPrice: number;
}> {
  const brackets: Array<{
    bracketType: "above" | "below" | "between";
    bracketMin: number;
    bracketMax: number;
    syntheticPrice: number;
  }> = [];

  // Generate brackets around the base temp (like real Polymarket markets)
  // "X or below"
  brackets.push({
    bracketType: "below",
    bracketMin: -Infinity,
    bracketMax: baseTemp - 3,
    syntheticPrice: 0, // will be set from uniform distribution
  });

  // "between X-Y" brackets (2-degree wide)
  for (let t = baseTemp - 3; t <= baseTemp + 5; t += 2) {
    brackets.push({
      bracketType: "between",
      bracketMin: t,
      bracketMax: t + 2,
      syntheticPrice: 0,
    });
  }

  // "X or higher"
  brackets.push({
    bracketType: "above",
    bracketMin: baseTemp + 5,
    bracketMax: Infinity,
    syntheticPrice: 0,
  });

  // Set synthetic prices: simulate retail mispricing by distributing
  // probability uniformly (retail assumption) instead of using model
  const n = brackets.length;
  for (const b of brackets) {
    b.syntheticPrice = 1 / n; // naive uniform pricing
  }

  return brackets;
}

async function runBacktest(days: number, filterCity?: string): Promise<BacktestResult> {
  const config = loadConfig();
  const cities = filterCity
    ? CITIES.filter((c) => c.slug === filterCity)
    : CITIES;

  const endDate = new Date();
  endDate.setDate(endDate.getDate() - 1); // yesterday
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days);

  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);

  logger.info({ startDate: startStr, endDate: endStr, cities: cities.length }, "Backtest starting");

  const trades: BacktestTrade[] = [];

  for (const city of cities) {
    logger.info({ city: city.name }, "Fetching historical data");

    // Fetch ensemble and actuals
    const dailyForecasts = await fetchHistoricalEnsemble(city, startStr, endStr);
    const actuals = await fetchActualTemps(city.iowaStation, startDate.getFullYear());

    // Also fetch current year if date range spans years
    if (endDate.getFullYear() !== startDate.getFullYear()) {
      const moreActuals = await fetchActualTemps(city.iowaStation, endDate.getFullYear());
      for (const [k, v] of moreActuals) actuals.set(k, v);
    }

    for (const forecast of dailyForecasts) {
      const actualHigh = actuals.get(forecast.date);
      if (actualHigh === undefined) continue; // no settlement data

      // Get the median forecast to generate realistic brackets
      const sortedHighs = [...forecast.highs].sort((a, b) => a - b);
      const median = sortedHighs[Math.floor(sortedHighs.length / 2)];

      const brackets = generateBrackets(median);

      for (const bracket of brackets) {
        // Calculate model probability
        let modelProb: number;
        if (bracket.bracketType === "between") {
          modelProb = calcBucketProbability(forecast, "high", bracket.bracketMin, bracket.bracketMax).probability;
        } else if (bracket.bracketType === "above") {
          modelProb = calcAboveProbability(forecast, "high", bracket.bracketMin);
        } else {
          modelProb = calcBelowProbability(forecast, "high", bracket.bracketMax);
        }

        const syntheticPrice = bracket.syntheticPrice;

        // Calculate edge
        const yesEdge = modelProb - syntheticPrice;
        const noEdge = (1 - modelProb) - (1 - syntheticPrice);

        let side: "YES" | "NO";
        let edge: number;
        let entryPrice: number;

        if (yesEdge >= noEdge && yesEdge > config.minEdgePct / 100) {
          side = "YES";
          edge = yesEdge;
          entryPrice = syntheticPrice;
        } else if (noEdge > config.minEdgePct / 100) {
          side = "NO";
          edge = noEdge;
          entryPrice = 1 - syntheticPrice;
        } else {
          continue; // no edge
        }

        // Determine outcome
        let inBracket: boolean;
        if (bracket.bracketType === "between") {
          inBracket = actualHigh >= bracket.bracketMin && actualHigh < bracket.bracketMax;
        } else if (bracket.bracketType === "above") {
          inBracket = actualHigh >= bracket.bracketMin;
        } else {
          inBracket = actualHigh < bracket.bracketMax;
        }

        const won = side === "YES" ? inBracket : !inBracket;
        const size = 1; // normalize to $1 per trade for analysis
        const pnl = won ? (1 - entryPrice) * size : -entryPrice * size;

        trades.push({
          city: city.slug,
          date: forecast.date,
          bracketType: bracket.bracketType,
          bracketMin: bracket.bracketMin,
          bracketMax: bracket.bracketMax,
          side,
          modelProb,
          entryPrice,
          edge,
          actualTemp: actualHigh,
          won,
          pnl,
        });
      }
    }

    await Bun.sleep(300); // rate limit between cities
  }

  // Compute stats
  const wins = trades.filter((t) => t.won).length;
  const losses = trades.length - wins;
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const avgEdge = trades.length > 0 ? trades.reduce((s, t) => s + t.edge, 0) / trades.length : 0;

  // Max drawdown
  let peak = 0;
  let cumPnl = 0;
  let maxDrawdown = 0;
  for (const t of trades) {
    cumPnl += t.pnl;
    if (cumPnl > peak) peak = cumPnl;
    const dd = peak - cumPnl;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // By city
  const byCity: Record<string, { trades: number; wins: number; pnl: number; winRate: number }> = {};
  for (const city of cities) {
    const cityTrades = trades.filter((t) => t.city === city.slug);
    const cityWins = cityTrades.filter((t) => t.won).length;
    byCity[city.slug] = {
      trades: cityTrades.length,
      wins: cityWins,
      pnl: Number(cityTrades.reduce((s, t) => s + t.pnl, 0).toFixed(2)),
      winRate: cityTrades.length > 0 ? cityWins / cityTrades.length : 0,
    };
  }

  return {
    trades,
    totalTrades: trades.length,
    wins,
    losses,
    winRate: trades.length > 0 ? wins / trades.length : 0,
    totalPnl: Number(totalPnl.toFixed(2)),
    avgEdge: Number(avgEdge.toFixed(4)),
    maxDrawdown: Number(maxDrawdown.toFixed(2)),
    byCity,
  };
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2);
  let days = 14;
  let city: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--days" && args[i + 1]) days = Number(args[i + 1]);
    if (args[i] === "--city" && args[i + 1]) city = args[i + 1];
  }

  console.log(`\nWeatherClaw Backtest — ${days} days${city ? `, ${city} only` : ", all cities"}\n`);

  const result = await runBacktest(days, city);

  console.log("=== RESULTS ===");
  console.log(`Total trades:  ${result.totalTrades}`);
  console.log(`Wins:          ${result.wins}`);
  console.log(`Losses:        ${result.losses}`);
  console.log(`Win rate:      ${(result.winRate * 100).toFixed(1)}%`);
  console.log(`Total P&L:     $${result.totalPnl} (per $1 trades)`);
  console.log(`Avg edge:      ${(result.avgEdge * 100).toFixed(1)}%`);
  console.log(`Max drawdown:  $${result.maxDrawdown}`);

  console.log("\n=== BY CITY ===");
  for (const [slug, stats] of Object.entries(result.byCity)) {
    console.log(
      `  ${slug.padEnd(10)} ${String(stats.trades).padStart(4)} trades  ` +
      `${(stats.winRate * 100).toFixed(0)}% win  $${stats.pnl.toFixed(2)} P&L`,
    );
  }

  console.log("");
  process.exit(0);
}

main().catch((err) => {
  logger.fatal({ err }, "Backtest failed");
  process.exit(1);
});
