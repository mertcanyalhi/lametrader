import { SymbolType } from '@lametrader/core';
import { describe } from 'vitest';
import { InMemoryMarketDataSource } from './in-memory-market-data-source.js';
import { runMarketDataSourceContract } from './testing/market-data-source.contract.js';

/**
 * Runs the shared {@link MarketDataSource} contract against the deterministic
 * in-memory adapter (the same contract runs against the real Binance/Yahoo
 * adapters in the `live` tier).
 */
describe('MarketDataSource contract: in-memory', () => {
  runMarketDataSourceContract(
    () =>
      new InMemoryMarketDataSource([
        {
          id: 'crypto:BTCUSDT',
          type: SymbolType.Crypto,
          description: 'Bitcoin / TetherUS',
          exchange: 'Binance',
          currency: 'USDT',
        },
        {
          id: 'crypto:ETHUSDT',
          type: SymbolType.Crypto,
          description: 'Ethereum / TetherUS',
          exchange: 'Binance',
          currency: 'USDT',
        },
      ]),
    { query: 'bitcoin', knownId: 'crypto:BTCUSDT', bogusId: 'crypto:NOPEUSDT' },
  );
});
