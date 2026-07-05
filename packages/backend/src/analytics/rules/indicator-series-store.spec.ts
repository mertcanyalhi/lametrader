import { type Candle, Period, StateValueType, SymbolType } from '@lametrader/core';
import { InMemoryCandleRepository } from '../../market/persistence/in-memory-candle.repository.js';
import { InMemoryWatchlistRepository } from '../../market/persistence/in-memory-watchlist.repository.js';
import { IndicatorService } from '../indicators/indicator.service.js';
import { IndicatorRegistry } from '../indicators/indicator-registry.js';
import { movingAverage } from '../indicators/sma.js';
import { IndicatorSeriesStore } from './indicator-series-store.js';

const SYMBOL = 'BTC';
const OTHER = 'ETH';
const PERIOD = Period.OneMinute;
const INSTANCE_ID = 'sma-3-inst';

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

  const store = new IndicatorSeriesStore(service);
  await store.warmup({
    instanceId: INSTANCE_ID,
    symbolId: SYMBOL,
    period: PERIOD,
    indicatorKey: 'sma',
    inputs: { length: 3, source: 'close' },
  });
  await store.warmup({
    instanceId: INSTANCE_ID,
    symbolId: OTHER,
    period: PERIOD,
    indicatorKey: 'sma',
    inputs: { length: 3, source: 'close' },
  });

  return { repo, store };
};

describe('IndicatorSeriesStore', () => {
  it('warmup rebuilds the series from candle history so latest() matches the SMA over the seeded bars for that symbol+period', async () => {
    const { store } = await setup();

    // SMA(3) over BTC [10,20,30,40,50] — last row is mean(30,40,50) = 40.
    expect(store.latest(SYMBOL, PERIOD, INSTANCE_ID, 'value')).toEqual({
      type: StateValueType.Number,
      value: 40,
    });
  });

  it('keeps independent series per symbol under the same instanceId so latest reads the requested symbol', async () => {
    const { store } = await setup();

    // Same instanceId, different symbol — ETH is flat at 100, so its SMA(3) is 100.
    expect(store.latest(OTHER, PERIOD, INSTANCE_ID, 'value')).toEqual({
      type: StateValueType.Number,
      value: 100,
    });
  });

  it('onBar appends a fresh row that matches what an SMA would compute over the warmup + new bar combined', async () => {
    const { repo, store } = await setup();
    const newBar = candle(6 * 60_000, 60);
    await repo.save(SYMBOL, PERIOD, [newBar]);

    await store.onBar(SYMBOL, PERIOD, newBar);

    // SMA(3) of BTC [40,50,60] = 50.
    expect(store.latest(SYMBOL, PERIOD, INSTANCE_ID, 'value')).toEqual({
      type: StateValueType.Number,
      value: 50,
    });
  });

  it('latest returns null for a slot that was never warmed', async () => {
    const { store } = await setup();

    expect(store.latest('DOGE', PERIOD, INSTANCE_ID, 'value')).toBeNull();
  });
});
