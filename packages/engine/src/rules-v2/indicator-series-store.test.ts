import {
  type IndicatorInstance,
  Period,
  SymbolType,
  type WatchedSymbol,
  type WatchlistRepository,
} from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { InMemoryCandleRepository } from '../candles/in-memory-candle-repository.js';
import { IndicatorRegistry } from '../indicators/indicator-registry.js';
import { IndicatorService } from '../indicators/indicator-service.js';
import { movingAverage } from '../indicators/sma.js';
import { IndicatorSeriesStore } from './indicator-series-store.js';

const noopSymbol: WatchedSymbol = {
  id: 'BTC',
  type: SymbolType.Crypto,
  description: 'BTC',
  exchange: 'Binance',
  periods: [Period.OneMinute],
};

const watchlist: WatchlistRepository = {
  list: async () => [noopSymbol],
  get: async (id) => (id === 'BTC' ? noopSymbol : null),
  add: async () => {},
  remove: async () => {},
};

const sampleCandle = (time: number, close: number) => ({
  type: SymbolType.Crypto as const,
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
  quoteVolume: close,
  trades: 1,
});

const instance: IndicatorInstance = {
  id: 'sma-1',
  indicatorKey: 'sma',
  version: 1,
  inputs: { length: 2, source: 'close' },
};

describe('IndicatorSeriesStore.rebuild', () => {
  it('loads the candle history via the injected compute fn and caches one numeric series per state-key keyed by (instanceId, stateKey)', async () => {
    const repo = new InMemoryCandleRepository();
    await repo.save('BTC', Period.OneMinute, [
      sampleCandle(100, 10),
      sampleCandle(200, 20),
      sampleCandle(300, 30),
      sampleCandle(400, 40),
    ]);
    const registry = new IndicatorRegistry();
    registry.register(movingAverage);
    const service = new IndicatorService(registry, watchlist, repo);
    const store = new IndicatorSeriesStore((symbolId, key, inputs, period, range) =>
      service.compute(symbolId, key, inputs, period, range),
    );
    await store.rebuild('BTC', Period.OneMinute, instance, { from: 0, to: 1_000 });
    const series = store.seriesFor('BTC', Period.OneMinute, 'sma-1', 'value');
    expect(series).not.toBeNull();
    expect(series?.samples()).toEqual([
      { ts: 200, value: 15 },
      { ts: 300, value: 25 },
      { ts: 400, value: 35 },
    ]);
  });
});

describe('IndicatorSeriesStore.appendForBar', () => {
  it('computes the single-bar window and appends — the resulting series equals a fresh full rebuild over the same candle range', async () => {
    const repo = new InMemoryCandleRepository();
    const seedCandles = [sampleCandle(100, 10), sampleCandle(200, 20), sampleCandle(300, 30)];
    await repo.save('BTC', Period.OneMinute, seedCandles);
    const registry = new IndicatorRegistry();
    registry.register(movingAverage);
    const service = new IndicatorService(registry, watchlist, repo);
    const store = new IndicatorSeriesStore((symbolId, key, inputs, period, range) =>
      service.compute(symbolId, key, inputs, period, range),
    );
    await store.rebuild('BTC', Period.OneMinute, instance, { from: 0, to: 250 });
    await repo.save('BTC', Period.OneMinute, [sampleCandle(300, 30)]);
    await store.appendForBar('BTC', Period.OneMinute, instance, 300);
    const incremental = store.seriesFor('BTC', Period.OneMinute, 'sma-1', 'value')?.samples();
    const freshStore = new IndicatorSeriesStore((symbolId, key, inputs, period, range) =>
      service.compute(symbolId, key, inputs, period, range),
    );
    await freshStore.rebuild('BTC', Period.OneMinute, instance, { from: 0, to: 1_000 });
    const fresh = freshStore.seriesFor('BTC', Period.OneMinute, 'sma-1', 'value')?.samples();
    expect(incremental).toEqual(fresh);
  });
});
