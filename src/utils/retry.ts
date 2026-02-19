import { logger } from "../logger.js";

// Fetch with retry + exponential backoff for transient API failures.
// Used by all external API calls (Open-Meteo, Gamma, NWS, Iowa State CLI).
export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  maxRetries = 3,
  baseDelayMs = 1000,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);

      // Retry on 429 (rate limit) and 5xx (server errors)
      if (res.status === 429 || res.status >= 500) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        logger.warn(
          { url, status: res.status, attempt, delay },
          "Retryable HTTP error",
        );
        if (attempt < maxRetries) {
          await Bun.sleep(delay);
          continue;
        }
      }

      return res;
    } catch (err) {
      lastError = err as Error;
      const delay = baseDelayMs * Math.pow(2, attempt);
      logger.warn(
        { url, error: (err as Error).message, attempt, delay },
        "Fetch error, retrying",
      );
      if (attempt < maxRetries) {
        await Bun.sleep(delay);
      }
    }
  }

  throw lastError ?? new Error(`Failed to fetch ${url} after ${maxRetries + 1} attempts`);
}
