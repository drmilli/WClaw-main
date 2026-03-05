
import { getDb } from "../store/db.js";
import { logger } from "../logger.js";
import { randomUUID } from "crypto";
import { fetchWeatherMarkets } from "../market/discovery.js";
import { parseAllMarkets } from "../market/parser.js";

// Helper to generate random number between min and max
function random(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

async function seed() {
  const db = getDb();
  const now = Date.now();
  
  logger.info("Fetching real weather markets from Polymarket...");
  const rawMarkets = await fetchWeatherMarkets();
  const parsedMarkets = parseAllMarkets(rawMarkets);
  
  if (parsedMarkets.length === 0) {
    logger.error("No active weather markets found. Cannot seed real data.");
    return;
  }
  
  logger.info(`Found ${parsedMarkets.length} active markets. Seeding 10 positions...`);

  // Shuffle markets to get random ones
  const shuffled = parsedMarkets.sort(() => 0.5 - Math.random()).slice(0, 10);
  const positions = [];

  for (const market of shuffled) {
    const size = Math.floor(random(10, 100)); // $10 - $100
    const price = market.yesPrice || random(0.1, 0.4); // Use real price if available
    const prob = price + random(0.05, 0.2); // Model higher than price
    const edge = prob - price;
    
    const pos = {
      id: randomUUID(),
      signal_id: randomUUID(),
      condition_id: market.conditionId,
      slug: market.slug,
      city: market.city,
      date: market.date,
      metric: market.metric,
      bracket_type: market.bracketType,
      bracket_min: market.bracketMin,
      bracket_max: market.bracketMax,
      side: "yes", // We always buy YES in this strategy
      entry_price: parseFloat(price.toFixed(2)),
      size: size,
      potential_payout: Math.floor(size / price),
      model_probability: parseFloat(prob.toFixed(2)),
      edge: parseFloat(edge.toFixed(2)),
      status: "open",
      entry_time: now - random(0, 86400000 * 2), // Past 48h
      settle_time: null,
      actual_temp: null,
      pnl: null,
      order_id: "demo_" + randomUUID().slice(0, 8)
    };

    db.run(`
      INSERT INTO positions (
        id, signal_id, condition_id, slug, city, date, metric, bracket_type, 
        bracket_min, bracket_max, side, entry_price, size, potential_payout,
        model_probability, edge, status, entry_time, order_id
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )
    `, [
      pos.id,
      pos.signal_id,
      pos.condition_id,
      pos.slug,
      pos.city,
      pos.date,
      pos.metric,
      pos.bracket_type,
      pos.bracket_min,
      pos.bracket_max,
      pos.side,
      pos.entry_price,
      pos.size,
      pos.potential_payout,
      pos.model_probability,
      pos.edge,
      pos.status,
      pos.entry_time,
      pos.order_id
    ]);

    positions.push(pos);
  }

  logger.info(`Successfully seeded ${positions.length} positions with real market data.`);
}

seed();
