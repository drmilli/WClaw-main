import { logger } from "./logger.js";
import { loadConfig, CITIES } from "./config.js";
import { fetchAllEnsembles } from "./weather/ensemble.js";
import { fetchAllEcmwfEnsembles } from "./weather/ecmwf.js";
import { fetchNWSForecast } from "./weather/nws.js";
import { fetchWeatherMarkets } from "./market/discovery.js";
import { parseAllMarkets } from "./market/parser.js";
import { generateSignals } from "./engine/signals.js";
import { executeSignal } from "./market/execution.js";
import { checkSettlements } from "./settlement/tracker.js";
import { insertSignal, insertPosition, getOpenPositions } from "./store/db.js";
import { printDashboard } from "./cli/dashboard.js";
import { checkRiskLimits, initRiskState, onSettlement } from "./engine/risk.js";
import { startWebDashboard } from "./cli/web.js";
import type { Signal, EnsembleForecast } from "./types.js";

const WEATHER_REFRESH_MS = 5 * 60 * 1000; // 5 minutes
const MARKET_SCAN_MS = 60 * 1000; // 60 seconds
const SETTLEMENT_CHECK_MS = 30 * 60 * 1000; // 30 minutes
const ECMWF_REFRESH_MS = 30 * 60 * 1000; // 30 minutes (less frequent)

async function main() {
  const config = loadConfig();
  logger.info({ mode: config.mode, bankroll: config.bankrollUsdc }, "WeatherClaw starting");

  // Initialize risk state from DB
  initRiskState();

  // Start web dashboard
  startWebDashboard();

  let lastWeatherFetch = 0;
  let lastEcmwfFetch = 0;
  let lastSettlementCheck = 0;
  let cycle = 0;

  let gfsEnsembles = new Map<string, EnsembleForecast>();
  let ecmwfEnsembles = new Map<string, EnsembleForecast>();
  let latestSignals: Signal[] = [];

  // Main loop
  while (true) {
    cycle++;
    const now = Date.now();

    try {
      // 1. Refresh GFS ensemble data
      if (now - lastWeatherFetch >= WEATHER_REFRESH_MS) {
        logger.info("Refreshing GFS ensemble forecasts...");
        gfsEnsembles = await fetchAllEnsembles(CITIES);
        lastWeatherFetch = now;
      }

      // 2. Refresh ECMWF ensemble data (less frequent)
      if (now - lastEcmwfFetch >= ECMWF_REFRESH_MS) {
        logger.info("Refreshing ECMWF ensemble forecasts...");
        ecmwfEnsembles = await fetchAllEcmwfEnsembles(CITIES);
        lastEcmwfFetch = now;
      }

      // 3. Scan markets
      const rawMarkets = await fetchWeatherMarkets();
      const parsedMarkets = parseAllMarkets(rawMarkets);

      // 4. Get open positions + risk check
      const openPositions = getOpenPositions();
      const risk = checkRiskLimits(config, openPositions);

      if (risk.circuitBroken) {
        logger.warn("Circuit breaker active — skipping signal generation");
        latestSignals = [];
      } else if (openPositions.length >= config.maxOpenPositions) {
        logger.info({ open: openPositions.length }, "Max positions reached");
        latestSignals = [];
      } else {
        // 5. Generate signals (pass both ensembles for consensus)
        latestSignals = generateSignals(
          parsedMarkets,
          gfsEnsembles,
          config,
          openPositions,
          ecmwfEnsembles,
        );

        // 6. Execute signals
        for (const signal of latestSignals) {
          if (openPositions.length >= config.maxOpenPositions) break;

          try {
            insertSignal(signal);
            const position = await executeSignal(signal, config);
            insertPosition(position);
            openPositions.push(position);
          } catch (err) {
            logger.error({ signal: signal.id, err }, "Execution failed");
          }
        }
      }

      // 7. Check settlements periodically
      if (now - lastSettlementCheck >= SETTLEMENT_CHECK_MS) {
        const settled = await checkSettlements();
        if (settled > 0) {
          logger.info({ settled }, "Positions settled");
        }
        lastSettlementCheck = now;
      }

      // 8. Print dashboard
      printDashboard(config, latestSignals, cycle);

    } catch (err) {
      logger.error({ err }, "Cycle error");
    }

    // Wait before next market scan
    await Bun.sleep(MARKET_SCAN_MS);
  }
}

main().catch((err) => {
  logger.fatal({ err }, "Fatal error");
  process.exit(1);
});
