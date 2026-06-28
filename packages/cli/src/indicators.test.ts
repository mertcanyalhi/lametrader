import {
  type Candle,
  IndicatorNotFoundError,
  Period,
  SymbolNotFoundError,
  SymbolType,
  type WatchedSymbol,
} from '@lametrader/core';
import {
  defaultIndicators,
  IndicatorService,
  InMemoryCandleRepository,
  InMemoryWatchlistRepository,
} from '@lametrader/engine';
import { describe, expect, it } from 'vitest';
import { runIndicators } from './indicators.js';

describe('runIndicators', () => {
  it('list prints every registered definition as JSON', async () => {
    const registry = defaultIndicators();
    expect(JSON.parse(await runIndicators(['list'], registry))).toEqual(registry.list());
  });

  it('show <key> prints the matching definition as JSON', async () => {
    const registry = defaultIndicators();
    expect(JSON.parse(await runIndicators(['show', 'sma'], registry))).toEqual(
      registry.get('sma')?.definition,
    );
  });

  it('show <key> throws IndicatorNotFoundError on an unknown key', async () => {
    const registry = defaultIndicators();
    await expect(runIndicators(['show', 'unknown-key'], registry)).rejects.toBeInstanceOf(
      IndicatorNotFoundError,
    );
  });

  it('throws on an unknown subcommand', async () => {
    const registry = defaultIndicators();
    await expect(runIndicators(['bogus'], registry)).rejects.toThrow();
  });
});

describe('runIndicators — compute', () => {
  const BTC: WatchedSymbol = {
    id: 'crypto:BTCUSDT',
    type: SymbolType.Crypto,
    description: 'Bitcoin',
    exchange: 'Binance',
    periods: [Period.OneHour],
  };
  const candle = (time: number, close: number): Candle => ({
    type: SymbolType.Crypto,
    time,
    open: close,
    high: close,
    low: close,
    close,
    volume: 10,
    quoteVolume: close * 10,
    trades: 1,
  });

  async function buildWithCompute() {
    const registry = defaultIndicators();
    const watchlist = new InMemoryWatchlistRepository([BTC]);
    const candles = new InMemoryCandleRepository();
    await candles.save(
      BTC.id,
      Period.OneHour,
      [10, 20, 30, 40, 50].map((c, i) => candle(i, c)),
    );
    const compute = new IndicatorService(registry, watchlist, candles);
    return { registry, compute };
  }

  it('compute <symbolId> <key> --period --inputs prints the result as JSON', async () => {
    const { registry, compute } = await buildWithCompute();
    const out = await runIndicators(
      ['compute', BTC.id, 'sma', '--period', '1h', '--inputs', '{"length":3}'],
      registry,
      compute,
    );
    expect(JSON.parse(out)).toEqual({
      indicatorKey: 'sma',
      version: 1,
      period: '1h',
      state: [
        { time: 0, value: null },
        { time: 1, value: null },
        { time: 2, value: 20 },
        { time: 3, value: 30 },
        { time: 4, value: 40 },
      ],
    });
  });

  it('compute throws SymbolNotFoundError when the symbol is not watched', async () => {
    const { registry, compute } = await buildWithCompute();
    await expect(
      runIndicators(['compute', 'crypto:UNWATCHED', 'sma', '--period', '1h'], registry, compute),
    ).rejects.toBeInstanceOf(SymbolNotFoundError);
  });
});
