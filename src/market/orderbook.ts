import { logger } from "../logger.js";
import { fetchWithRetry } from "../utils/retry.js";

const CLOB_API = "https://clob.polymarket.com";

export interface OrderBookSummary {
  tokenId: string;
  bestBid: number;
  bestAsk: number;
  bidDepthUsdc: number;
  askDepthUsdc: number;
  spread: number;
}

/**
 * Fetch order book for a token from the CLOB API.
 */
export async function fetchOrderBook(tokenId: string): Promise<OrderBookSummary | null> {
  try {
    const url = `${CLOB_API}/book?token_id=${tokenId}`;
    const res = await fetchWithRetry(url, {}, 2, 500);
    if (!res.ok) {
      logger.warn({ tokenId, status: res.status }, "Order book fetch failed");
      return null;
    }

    const data = (await res.json()) as OrderBookResponse;

    const bids = (data.bids ?? []).map((o) => ({ price: Number(o.price), size: Number(o.size) }));
    const asks = (data.asks ?? []).map((o) => ({ price: Number(o.price), size: Number(o.size) }));

    const bestBid = bids.length > 0 ? Math.max(...bids.map((b) => b.price)) : 0;
    const bestAsk = asks.length > 0 ? Math.min(...asks.map((a) => a.price)) : 1;
    const bidDepthUsdc = bids.reduce((sum, b) => sum + b.price * b.size, 0);
    const askDepthUsdc = asks.reduce((sum, a) => sum + a.price * a.size, 0);

    return {
      tokenId,
      bestBid,
      bestAsk,
      bidDepthUsdc,
      askDepthUsdc,
      spread: bestAsk - bestBid,
    };
  } catch (err) {
    logger.error({ tokenId, err }, "Order book error");
    return null;
  }
}

interface OrderBookResponse {
  bids?: Array<{ price: string; size: string }>;
  asks?: Array<{ price: string; size: string }>;
}
