import { logger } from "../logger.js";
import { fetchWithRetry } from "../utils/retry.js";
import type { CityConfig, EnsembleForecast, DailyForecast } from "../types.js";

const ENSEMBLE_MEMBERS = 51; // ECMWF has 51 members (1 control + 50 perturbed)
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours (ECMWF updates 2x daily)

const cache = new Map<string, EnsembleForecast>();

function celsiusToFahrenheit(c: number): number {
  return c * 9 / 5 + 32;
}

/**
 * Fetch ECMWF IFS ensemble from Open-Meteo.
 * Higher accuracy than GFS but updates less frequently (2x/day vs 4x/day).
 */
export async function fetchEcmwfEnsemble(city: CityConfig): Promise<EnsembleForecast> {
  const cached = cache.get(city.slug);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached;
  }

  const url = new URL("https://ensemble-api.open-meteo.com/v1/ensemble");
  url.searchParams.set("latitude", String(city.lat));
  url.searchParams.set("longitude", String(city.lon));
  url.searchParams.set("hourly", "temperature_2m");
  url.searchParams.set("models", "ecmwf_ifs025");
  url.searchParams.set("forecast_days", "7");
  url.searchParams.set("temperature_unit", "celsius");

  logger.debug({ city: city.name }, "Fetching ECMWF ensemble");

  const res = await fetchWithRetry(url.toString());
  if (!res.ok) {
    throw new Error(`ECMWF ensemble API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json() as EnsembleResponse;
  const forecast = parseEnsembleResponse(city, data);

  cache.set(city.slug, forecast);
  logger.info({ city: city.name, days: forecast.daily.length, members: "ecmwf" }, "ECMWF forecast cached");

  return forecast;
}

function parseEnsembleResponse(city: CityConfig, data: EnsembleResponse): EnsembleForecast {
  const hourly = data.hourly;
  const times = hourly.time;

  const memberKeys: string[] = [];
  for (const key of Object.keys(hourly)) {
    if (key === "temperature_2m" || key.startsWith("temperature_2m_member")) {
      memberKeys.push(key);
    }
  }

  const byDate = new Map<string, number[][]>();

  for (let i = 0; i < times.length; i++) {
    const date = times[i].slice(0, 10);
    if (!byDate.has(date)) {
      byDate.set(date, memberKeys.map(() => []));
    }
    const members = byDate.get(date)!;
    for (let m = 0; m < memberKeys.length; m++) {
      const val = (hourly as Record<string, number[]>)[memberKeys[m]][i];
      if (val != null) {
        members[m].push(celsiusToFahrenheit(val));
      }
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
    if (highs.length > 0) {
      daily.push({ date, highs, lows });
    }
  }

  return {
    city: city.slug,
    fetchedAt: Date.now(),
    daily,
  };
}

export async function fetchAllEcmwfEnsembles(cities: CityConfig[]): Promise<Map<string, EnsembleForecast>> {
  const results = new Map<string, EnsembleForecast>();
  // Sequential with delay to avoid 429 rate limits from Open-Meteo
  for (const city of cities) {
    try {
      const forecast = await fetchEcmwfEnsemble(city);
      results.set(city.slug, forecast);
    } catch (err) {
      logger.error({ city: city.name, err }, "Failed to fetch ECMWF ensemble");
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return results;
}

interface EnsembleResponse {
  hourly: {
    time: string[];
    [key: string]: number[] | string[];
  };
}
