import { Period, SymbolType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { InMemoryCandleRepository } from '../candles/in-memory-candle-repository.js';
import { BarAxis, barSeries } from './bar-series.js';

describe('barSeries', () => {
  it('returns a SeriesView whose samples are the candle window per-axis values ascending by ts', async () => {
    const repo = new InMemoryCandleRepository();
    await repo.save('BTC', Period.OneMinute, [
      {
        type: SymbolType.Crypto,
        time: 100,
        open: 10,
        high: 12,
        low: 9,
        close: 11,
        volume: 100,
        quoteVolume: 1_100,
        trades: 5,
      },
      {
        type: SymbolType.Crypto,
        time: 200,
        open: 11,
        high: 13,
        low: 10,
        close: 12,
        volume: 200,
        quoteVolume: 2_400,
        trades: 7,
      },
      {
        type: SymbolType.Crypto,
        time: 300,
        open: 12,
        high: 15,
        low: 11,
        close: 14,
        volume: 300,
        quoteVolume: 4_200,
        trades: 11,
      },
    ]);
    const series = await barSeries(repo, 'BTC', Period.OneMinute, BarAxis.Close, {
      from: 0,
      to: 1_000,
    });
    expect(series.samples()).toEqual([
      { ts: 100, value: 11 },
      { ts: 200, value: 12 },
      { ts: 300, value: 14 },
    ]);
    expect(series.latest()).toEqual({ ts: 300, value: 14 });
    expect(series.asOf(250)).toEqual({ ts: 200, value: 12 });
  });
});
