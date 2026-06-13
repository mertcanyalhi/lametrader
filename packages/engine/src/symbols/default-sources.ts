import type { MarketDataSource } from '@lametrader/core';
import { BinanceMarketDataSource } from './binance-market-data-source.js';
import { YahooMarketDataSource } from './yahoo-market-data-source.js';

/**
 * The platform's default market-data sources: Binance (crypto) and Yahoo
 * (stocks/funds/FX). This is the **single registration point** — adding a
 * provider means adding a new adapter here, and nowhere else (OCP). The
 * composition root ({@link import('../connect.js').connectServices}) is the only
 * caller.
 */
export function defaultMarketDataSources(): MarketDataSource[] {
  return [new BinanceMarketDataSource(), new YahooMarketDataSource()];
}
