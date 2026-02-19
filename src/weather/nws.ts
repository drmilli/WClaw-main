import { logger } from "../logger.js";
import { fetchWithRetry } from "../utils/retry.js";
import type { CityConfig } from "../types.js";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface NWSForecast {
  city: string;
  fetchedAt: number;
  periods: NWSPeriod[];
}

interface NWSPeriod {
  name: string;
  startTime: string;
  endTime: string;
  temperature: number; // Fahrenheit
  isDaytime: boolean;
}

const cache = new Map<string, NWSForecast>();

/**
 * Fetch NWS hourly gridpoint forecast as a tiebreaker signal.
 * This is the official NWS point forecast, not ensemble data.
 */
export async function fetchNWSForecast(city: CityConfig): Promise<NWSForecast | null> {
  const cached = cache.get(city.slug);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached;
  }

  try {
    const url = `https://api.weather.gov/gridpoints/${city.nwsGridId}/${city.nwsGridX},${city.nwsGridY}/forecast`;
    const res = await fetchWithRetry(url, {
      headers: { "User-Agent": "WeatherClaw/1.0 (weather-bot)" },
    });

    if (!res.ok) {
      logger.warn({ city: city.name, status: res.status }, "NWS API error");
      return null;
    }

    const data = (await res.json()) as NWSApiResponse;
    if (!data.properties?.periods) return null;

    const forecast: NWSForecast = {
      city: city.slug,
      fetchedAt: Date.now(),
      periods: data.properties.periods.map((p) => ({
        name: p.name,
        startTime: p.startTime,
        endTime: p.endTime,
        temperature: p.temperature,
        isDaytime: p.isDaytime,
      })),
    };

    cache.set(city.slug, forecast);
    logger.debug({ city: city.name, periods: forecast.periods.length }, "NWS forecast cached");

    return forecast;
  } catch (err) {
    logger.error({ city: city.name, err }, "NWS fetch failed");
    return null;
  }
}

/**
 * Get NWS predicted high for a specific date.
 */
export function getNWSHigh(forecast: NWSForecast, date: string): number | null {
  // NWS periods are named like "Monday", "Monday Night", "Tuesday", etc.
  // Daytime periods have the high, nighttime have the low
  for (const p of forecast.periods) {
    const periodDate = p.startTime.slice(0, 10);
    if (periodDate === date && p.isDaytime) {
      return p.temperature;
    }
  }
  return null;
}

interface NWSApiResponse {
  properties?: {
    periods?: Array<{
      name: string;
      startTime: string;
      endTime: string;
      temperature: number;
      temperatureUnit: string;
      isDaytime: boolean;
    }>;
  };
}
