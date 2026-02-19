import { logger } from "../logger.js";
import { fetchWithRetry } from "../utils/retry.js";
import type { Signal, Position, AppConfig } from "../types.js";
import { fetchOrderBook } from "./orderbook.js";

const MIN_LIQUIDITY_USDC = 500;

// Paper trade execution — logs what would have been traded.
export function executePaper(signal: Signal): Position {
  const position: Position = {
    id: crypto.randomUUID(),
    signalId: signal.id,
    conditionId: signal.market.conditionId,
    city: signal.market.city,
    date: signal.market.date,
    metric: signal.market.metric,
    bracketMin: signal.market.bracketMin,
    bracketMax: signal.market.bracketMax,
    bracketType: signal.market.bracketType,
    side: signal.side,
    entryPrice: signal.marketPrice,
    size: signal.size,
    potentialPayout: signal.size / signal.marketPrice,
    modelProbability: signal.modelProbability,
    edge: signal.edge,
    status: "open",
    entryTime: Date.now(),
  };

  logger.info(
    {
      city: position.city,
      date: position.date,
      side: position.side,
      price: position.entryPrice.toFixed(3),
      size: `$${position.size.toFixed(2)}`,
      edge: `${(position.edge * 100).toFixed(1)}%`,
    },
    "PAPER TRADE",
  );

  return position;
}

// --- Pre-flight checks for live mode ---

async function checkWalletBalance(config: AppConfig): Promise<number> {
  if (!config.polygonPrivateKey) throw new Error("POLYGON_PRIVATE_KEY not set");

  try {
    const { ethers } = await import("ethers");
    const provider = new ethers.JsonRpcProvider("https://polygon-rpc.com");
    const wallet = new ethers.Wallet(config.polygonPrivateKey, provider);

    // Check MATIC balance for gas
    const maticBalance = await provider.getBalance(wallet.address);
    const maticEth = Number(ethers.formatEther(maticBalance));
    if (maticEth < 0.01) {
      logger.warn({ matic: maticEth.toFixed(4) }, "Low MATIC balance — may not have enough for gas");
    }

    // Check USDC balance (USDC on Polygon: 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174)
    const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
    const erc20Abi = ["function balanceOf(address) view returns (uint256)"];
    const usdc = new ethers.Contract(USDC_ADDRESS, erc20Abi, provider);
    const usdcRaw = await usdc.balanceOf(wallet.address);
    const usdcBalance = Number(usdcRaw) / 1e6; // USDC has 6 decimals

    logger.info(
      { address: wallet.address, usdc: usdcBalance.toFixed(2), matic: maticEth.toFixed(4) },
      "Wallet balance check",
    );

    return usdcBalance;
  } catch (err) {
    logger.error({ err }, "Wallet balance check failed — continuing anyway");
    return -1; // unknown balance, don't block
  }
}

let preflightDone = false;
let walletBalance = -1;

async function runPreflight(config: AppConfig): Promise<void> {
  if (preflightDone) return;

  logger.info("Running live mode pre-flight checks...");

  if (!config.polygonPrivateKey) {
    throw new Error("Cannot run live mode without POLYGON_PRIVATE_KEY");
  }

  walletBalance = await checkWalletBalance(config);
  if (walletBalance >= 0 && walletBalance < config.bankrollUsdc * 0.1) {
    logger.warn(
      { walletUsdc: walletBalance, configBankroll: config.bankrollUsdc },
      "Wallet USDC balance is much lower than configured bankroll",
    );
  }

  // Test CLOB API connectivity
  try {
    const res = await fetchWithRetry("https://clob.polymarket.com/time", {}, 1, 1000);
    if (res.ok) {
      logger.info("CLOB API reachable");
    } else {
      logger.warn({ status: res.status }, "CLOB API returned non-200");
    }
  } catch {
    logger.warn("CLOB API unreachable — orders may fail");
  }

  preflightDone = true;
}

// --- Live execution via Polymarket CLOB ---

let clobClient: any = null;
let clobInitFailed = false;
let usingFallback = false;

async function getClobClient(config: AppConfig) {
  if (clobClient) return clobClient;
  if (clobInitFailed && !usingFallback) {
    throw new Error("CLOB client init previously failed and no fallback available");
  }

  try {
    // @polymarket/clob-client uses ethers v5 internally
    const { Wallet } = await import("@ethersproject/wallet");
    const { ClobClient } = await import("@polymarket/clob-client");

    if (!config.polygonPrivateKey) {
      throw new Error("POLYGON_PRIVATE_KEY not set");
    }

    const signer = new Wallet(config.polygonPrivateKey);
    const chainId = 137; // Polygon mainnet

    // If we have API creds, use them; otherwise derive them
    let creds: any;
    if (config.polymarketApiKey && config.polymarketApiSecret && config.polymarketApiPassphrase) {
      creds = {
        key: config.polymarketApiKey,
        secret: config.polymarketApiSecret,
        passphrase: config.polymarketApiPassphrase,
      };
    }

    const client = new ClobClient(
      "https://clob.polymarket.com",
      chainId,
      signer,
      creds,
    );

    // If no creds provided, derive them
    if (!creds) {
      logger.info("Deriving Polymarket API key...");
      const derivedCreds = await client.createOrDeriveApiKey();
      logger.info({ key: derivedCreds.key }, "API key derived");

      clobClient = new ClobClient(
        "https://clob.polymarket.com",
        chainId,
        signer,
        derivedCreds,
      );
      return clobClient;
    }

    clobClient = client;
    return clobClient;
  } catch (err) {
    clobInitFailed = true;
    logger.error({ err }, "CLOB client init failed — check if @polymarket/clob-client works with Bun");
    throw err;
  }
}

// Live trade execution via Polymarket CLOB.
export async function executeLive(signal: Signal, config: AppConfig): Promise<Position> {
  // Run pre-flight on first live trade
  await runPreflight(config);

  const client = await getClobClient(config);

  // Determine which token to buy
  const tokenId = signal.side === "YES"
    ? signal.market.yesTokenId
    : signal.market.noTokenId;

  // Check order book liquidity
  const book = await fetchOrderBook(tokenId);
  if (book && book.askDepthUsdc < MIN_LIQUIDITY_USDC) {
    throw new Error(`Insufficient liquidity: $${book.askDepthUsdc.toFixed(0)} (min: $${MIN_LIQUIDITY_USDC})`);
  }

  // Use best ask price if available and better than signal price
  let limitPrice = signal.marketPrice;
  if (book && book.bestAsk > 0 && book.bestAsk <= signal.marketPrice * 1.02) {
    limitPrice = book.bestAsk;
  }

  // Calculate size in tokens (USDC amount / price = tokens)
  const tokenSize = Math.floor(signal.size / limitPrice);
  if (tokenSize === 0) {
    throw new Error(
      `Token size rounds to 0 (size=$${signal.size.toFixed(2)}, price=${limitPrice.toFixed(4)}) — increase position size`,
    );
  }

  logger.info(
    {
      city: signal.market.city,
      date: signal.market.date,
      side: signal.side,
      tokenId: tokenId.slice(0, 12) + "...",
      price: limitPrice.toFixed(3),
      size: `$${signal.size.toFixed(2)}`,
      tokens: tokenSize,
    },
    "Placing LIVE order",
  );

  // Create and post limit order (GTC)
  const { Side, OrderType } = await import("@polymarket/clob-client");
  const signedOrder = await client.createOrder({
    tokenID: tokenId,
    price: limitPrice,
    side: Side.BUY,
    size: tokenSize,
    feeRateBps: 0,
  });

  const result = await client.postOrder(signedOrder, OrderType.GTC);

  const position: Position = {
    id: crypto.randomUUID(),
    signalId: signal.id,
    conditionId: signal.market.conditionId,
    city: signal.market.city,
    date: signal.market.date,
    metric: signal.market.metric,
    bracketMin: signal.market.bracketMin,
    bracketMax: signal.market.bracketMax,
    bracketType: signal.market.bracketType,
    side: signal.side,
    entryPrice: limitPrice,
    size: signal.size,
    potentialPayout: signal.size / limitPrice,
    modelProbability: signal.modelProbability,
    edge: signal.edge,
    status: "open",
    entryTime: Date.now(),
    // Polymarket CLOB API returns orderID on the response object.
    // Fallback chain covers potential field name variations across API versions.
    orderId: result?.orderID ?? result?.order_id ?? result?.id ?? undefined,
  };

  logger.info(
    {
      orderId: position.orderId,
      city: position.city,
      side: position.side,
      price: position.entryPrice.toFixed(3),
      size: `$${position.size.toFixed(2)}`,
    },
    "LIVE ORDER PLACED",
  );

  return position;
}

export async function executeSignal(signal: Signal, config: AppConfig): Promise<Position> {
  if (config.mode === "live") {
    return executeLive(signal, config);
  }
  return executePaper(signal);
}
