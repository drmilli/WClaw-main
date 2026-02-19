import { logger } from "../logger.js";
import { fetchWithRetry } from "../utils/retry.js";
import type { CityConfig, EnsembleForecast, DailyForecast } from "../types.js";

const ENSEMBLE_MEMBERS = 31;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours (GFS updates 4x daily)

const cache = new Map<string, EnsembleForecast>();

function celsiusToFahrenheit(c: number): number {
  return c * 9 / 5 + 32;
}

export async function fetchEnsemble(city: CityConfig): Promise<EnsembleForecast> {
  const cached = cache.get(city.slug);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached;
  }

  const url = new URL("https://ensemble-api.open-meteo.com/v1/ensemble");
  url.searchParams.set("latitude", String(city.lat));
  url.searchParams.set("longitude", String(city.lon));
  url.searchParams.set("hourly", "temperature_2m");
  url.searchParams.set("models", "gfs_seamless");
  url.searchParams.set("forecast_days", "7");
  url.searchParams.set("temperature_unit", "celsius");

  logger.debug({ city: city.name }, "Fetching GFS ensemble");

  const res = await fetchWithRetry(url.toString());
  if (!res.ok) {
    throw new Error(`Open-Meteo ensemble API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json() as OpenMeteoEnsembleResponse;
  const forecast = parseEnsembleResponse(city, data);

  cache.set(city.slug, forecast);
  logger.info({ city: city.name, days: forecast.daily.length }, "Ensemble forecast cached");

  return forecast;
}

function parseEnsembleResponse(city: CityConfig, data: OpenMeteoEnsembleResponse): EnsembleForecast {
  const hourly = data.hourly;
  const times = hourly.time; // ISO timestamps

  // Collect all member keys: temperature_2m_member01 ... temperature_2m_member30, plus temperature_2m (member 0)
  const memberKeys: string[] = [];
  for (const key of Object.keys(hourly)) {
    if (key === "temperature_2m" || key.startsWith("temperature_2m_member")) {
      memberKeys.push(key);
    }
  }

  if (memberKeys.length < ENSEMBLE_MEMBERS) {
    logger.warn({ city: city.name, members: memberKeys.length }, "Fewer ensemble members than expected");
  }

  // Group hourly temps by date
  const byDate = new Map<string, number[][]>(); // date -> member[] -> hourly temps

  for (let i = 0; i < times.length; i++) {
    const date = times[i].slice(0, 10); // YYYY-MM-DD
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

  // Extract daily high/low per member
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

// Open-Meteo response shape
interface OpenMeteoEnsembleResponse {
  hourly: {
    time: string[];
    [key: string]: number[] | string[];
  };
}

export async function fetchAllEnsembles(cities: CityConfig[]): Promise<Map<string, EnsembleForecast>> {
  const results = new Map<string, EnsembleForecast>();
  // Sequential with delay to avoid 429 rate limits from Open-Meteo
  for (const city of cities) {
    try {
      const forecast = await fetchEnsemble(city);
      results.set(city.slug, forecast);
    } catch (err) {
      logger.error({ city: city.name, err }, "Failed to fetch ensemble");
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return results;
}
