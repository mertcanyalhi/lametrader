import { type Candle, Period, StateValueType, SymbolType } from '@lametrader/core';

import { InMemoryCandleRepository } from '../../market/persistence/in-memory-candle.repository.js';
import { type BarAxis, BarSeriesView } from './bar-series-view.js';

const SYMBOL = 'BTC';
const PERIOD = Period.OneMinute;

const candle = (time: number, close: number): Candle => ({
  type: SymbolType.Crypto,
  time,
  open: close - 0.5,
  high: close + 1,
  low: close - 1,
  close,
  volume: close * 10,
  quoteVolume: close * 100,
  trades: 1,
});

describe('BarSeriesView', () => {
  it('reads the close axis newest-first with length matching the in-window bar count', async () => {
    const repo = new InMemoryCandleRepository();
    await repo.save(SYMBOL, PERIOD, [candle(1000, 10), candle(2000, 11), candle(3000, 12)]);

    const view = await BarSeriesView.load(repo, SYMBOL, PERIOD, 0, 4000, 'close' as BarAxis);

    expect({
      length: view.length,
      walked: [...view.backwardWalk()],
    }).toEqual({
      length: 3,
      walked: [
        { ts: 3000, value: { type: StateValueType.Number, value: 12 } },
        { ts: 2000, value: { type: StateValueType.Number, value: 11 } },
        { ts: 1000, value: { type: StateValueType.Number, value: 10 } },
      ],
    });
  });

  it('asOf returns the OHLCV-axis value of the latest bar with time <= queryTs', async () => {
    const repo = new InMemoryCandleRepository();
    await repo.save(SYMBOL, PERIOD, [candle(1000, 10), candle(2000, 11), candle(3000, 12)]);

    const view = await BarSeriesView.load(repo, SYMBOL, PERIOD, 0, 4000, 'high' as BarAxis);

    expect(view.asOf(2500)).toEqual({
      ts: 2000,
      value: { type: StateValueType.Number, value: 12 },
    });
    expect(view.asOf(500)).toEqual(null);
  });
});
