import { type Candle, Period, StateValueType, SymbolType } from '@lametrader/core';
import { InMemoryCandleRepository } from '../../market/persistence/in-memory-candle.repository.js';
import { InMemoryWatchlistRepository } from '../../market/persistence/in-memory-watchlist.repository.js';
import { IndicatorService } from '../indicators/indicator.service.js';
import { IndicatorRegistry } from '../indicators/indicator-registry.js';
import { movingAverage } from '../indicators/sma.js';
import { IndicatorSeriesStore } from './indicator-series-store.js';
import type { SeriesPoint } from './series.types.js';

const SYMBOL = 'BTC';
const OTHER = 'ETH';
const PERIOD = Period.OneMinute;
const INSTANCE_ID = 'sma-3-inst';
const NO_UPPER_BOUND = Number.MAX_SAFE_INTEGER;

const candle = (time: number, close: number): Candle => ({
  type: SymbolType.Crypto,
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
  quoteVolume: close,
  trades: 1,
});

/** Drain an async backward walk into an array for full-payload assertions. */
async function collect<T>(iter: AsyncIterableIterator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

const setup = async (): Promise<{
  repo: InMemoryCandleRepository;
  store: IndicatorSeriesStore;
}> => {
  const repo = new InMemoryCandleRepository();
  const btc = [10, 20, 30, 40, 50].map((c, i) => candle((i + 1) * 60_000, c));
  const eth = [100, 100, 100, 100, 100].map((c, i) => candle((i + 1) * 60_000, c));
  await repo.save(SYMBOL, PERIOD, btc);
  await repo.save(OTHER, PERIOD, eth);

  const watchlist = new InMemoryWatchlistRepository([
    {
      id: SYMBOL,
      type: SymbolType.Crypto,
      description: 'BTC',
      exchange: 'Binance',
      periods: [PERIOD],
    },
    {
      id: OTHER,
      type: SymbolType.Crypto,
      description: 'ETH',
      exchange: 'Binance',
      periods: [PERIOD],
    },
  ]);
  const indicators = new IndicatorRegistry();
  indicators.register(movingAverage);
  const service = new IndicatorService(indicators, watchlist, repo);

  const store = new IndicatorSeriesStore(repo, service);
  store.register({
    instanceId: INSTANCE_ID,
    indicatorKey: 'sma',
    inputs: { length: 3, source: 'close' },
  });

  return { repo, store };
};

describe('IndicatorSeriesStore', () => {
  it('resolves a registered instance to a lazy view whose latest matches the SMA over the seeded bars', async () => {
    const { store } = await setup();
    const view = store.series(SYMBOL, PERIOD, INSTANCE_ID, 'value', NO_UPPER_BOUND);

    // SMA(3) over BTC [10,20,30,40,50] — newest row is mean(30,40,50) = 40.
    expect(await view.asOf(NO_UPPER_BOUND)).toEqual({
      ts: 300_000,
      value: { type: StateValueType.Number, value: 40 },
    });
  });

  it('keeps independent series per symbol under the same instanceId so the requested symbol is read', async () => {
    const { store } = await setup();
    const view = store.series(OTHER, PERIOD, INSTANCE_ID, 'value', NO_UPPER_BOUND);

    // Same instanceId, different symbol — ETH is flat at 100, so its SMA(3) is 100.
    expect(await view.asOf(NO_UPPER_BOUND)).toEqual({
      ts: 300_000,
      value: { type: StateValueType.Number, value: 100 },
    });
  });

  it('returns an empty view for an instance that was never registered', async () => {
    const { store } = await setup();
    const view = store.series(SYMBOL, PERIOD, 'unknown-inst', 'value', NO_UPPER_BOUND);

    expect(await collect(view.backwardWalk())).toEqual([]);
  });

  it('drops a registered config on unregister so its series returns an empty view again', async () => {
    const { store } = await setup();
    store.unregister(INSTANCE_ID);
    const view = store.series(SYMBOL, PERIOD, INSTANCE_ID, 'value', NO_UPPER_BOUND);

    expect(await collect(view.backwardWalk())).toEqual([]);
  });

  it('bounds the resolved series above by before, excluding a bar stored at or after it', async () => {
    const { store } = await setup();
    // Bound below the 300s bar — only bars with time < 300_000 are read.
    const view = store.series(SYMBOL, PERIOD, INSTANCE_ID, 'value', 300_000);
    const walked: SeriesPoint[] = await collect(view.backwardWalk());

    // SMA(3) over [10,20,30,40]: 240s = mean(20,30,40) = 30, 180s = mean(10,20,30) = 20;
    // the 300s bar (close 50) is excluded, so it never becomes the newest point.
    expect(walked).toEqual([
      { ts: 240_000, value: { type: StateValueType.Number, value: 30 } },
      { ts: 180_000, value: { type: StateValueType.Number, value: 20 } },
    ]);
  });
});
