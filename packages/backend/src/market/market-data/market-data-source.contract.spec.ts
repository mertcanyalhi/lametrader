import { type CryptoCandle, Period, SymbolType } from '@lametrader/core';
import { InMemoryMarketDataSource } from './in-memory-market-data-source.js';
import { runMarketDataSourceContract } from './testing/market-data-source.contract.js';

/** A crypto candle at `time`, to seed the in-memory source's `fetchCandles`. */
const candle = (time: number): CryptoCandle => ({
  type: SymbolType.Crypto,
  time,
  open: 1,
  high: 2,
  low: 0.5,
  close: 1.5,
  volume: 10,
  quoteVolume: 15,
  trades: 3,
});

/**
 * Runs the shared {@link MarketDataSource} contract against the deterministic
 * in-memory adapter (the same contract runs against the real Binance/Yahoo
 * adapters in the `live` tier).
 */
describe('MarketDataSource contract: in-memory', () => {
  runMarketDataSourceContract(
    () =>
      new InMemoryMarketDataSource(
        [
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
        ],
        [SymbolType.Crypto],
        [{ id: 'crypto:BTCUSDT', period: Period.OneHour, candles: [candle(1000), candle(2000)] }],
      ),
    {
      query: 'bitcoin',
      knownId: 'crypto:BTCUSDT',
      bogusId: 'crypto:NOPEUSDT',
      candlePeriod: Period.OneHour,
    },
  );
});
