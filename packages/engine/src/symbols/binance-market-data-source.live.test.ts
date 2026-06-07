import { describe } from 'vitest';
import { BinanceMarketDataSource } from './binance-market-data-source.js';
import { runMarketDataSourceContract } from './testing/market-data-source.contract.js';

/**
 * The shared {@link MarketDataSource} contract against the real Binance API.
 * Live tier (manual): hits the network.
 */
describe('MarketDataSource contract: Binance (live)', () => {
  runMarketDataSourceContract(() => new BinanceMarketDataSource(), {
    query: 'BTC',
    knownId: 'crypto:BTCUSDT',
    bogusId: 'crypto:NOPEUSDT',
  });
});
