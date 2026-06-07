import { describe } from 'vitest';
import { runMarketDataSourceContract } from './testing/market-data-source.contract.js';
import { YahooMarketDataSource } from './yahoo-market-data-source.js';

/**
 * The shared {@link MarketDataSource} contract against the real Yahoo Finance API.
 * Live tier (manual): hits the network.
 */
describe('MarketDataSource contract: Yahoo (live)', () => {
  runMarketDataSourceContract(() => new YahooMarketDataSource(), {
    query: 'apple',
    knownId: 'stock:AAPL',
    bogusId: 'stock:NOPENOPE',
  });
});
