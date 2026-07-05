import {
  type Candle,
  Period,
  type Profile,
  ProfileScope,
  StateValueType,
  SymbolType,
} from '@lametrader/core';
import { InMemoryCandleRepository } from '../../../market/persistence/in-memory-candle.repository.js';
import { InMemoryWatchlistRepository } from '../../../market/persistence/in-memory-watchlist.repository.js';
import { defaultIndicators } from '../../indicators/default-indicators.js';
import { IndicatorService } from '../../indicators/indicator.service.js';
import { InMemoryProfileRepository } from '../../persistence/in-memory-profile.repository.js';
import { IndicatorSeriesStore } from '../indicator-series-store.js';
import { registerIndicatorInstances } from './register-indicator-instances.js';

const SYMBOL = 'BTC';
const PERIOD = Period.OneMinute;
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

const profile = (overrides: Partial<Profile> & Pick<Profile, 'id' | 'indicators'>): Profile => ({
  name: overrides.id,
  description: '',
  enabled: true,
  scope: { type: ProfileScope.All },
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

/** Seed a store over three BTC closes so SMA(3) resolves to 20. */
const seed = async (profiles: InMemoryProfileRepository): Promise<IndicatorSeriesStore> => {
  const candles = new InMemoryCandleRepository();
  const bars = [10, 20, 30].map((c, i) => candle((i + 1) * 60_000, c));
  await candles.save(SYMBOL, PERIOD, bars);
  const watchlist = new InMemoryWatchlistRepository([
    {
      id: SYMBOL,
      type: SymbolType.Crypto,
      description: 'BTC',
      exchange: 'Binance',
      periods: [PERIOD],
    },
  ]);
  const store = new IndicatorSeriesStore(
    candles,
    new IndicatorService(defaultIndicators(), watchlist, candles),
  );
  await registerIndicatorInstances({ store, profiles });
  return store;
};

describe('registerIndicatorInstances', () => {
  it('registers each enabled profile instance so its IndicatorRef series resolves', async () => {
    const profiles = new InMemoryProfileRepository([
      profile({
        id: 'p1',
        indicators: [
          {
            id: 'sma-inst',
            indicatorKey: 'sma',
            version: 1,
            inputs: { length: 3, source: 'close' },
          },
        ],
      }),
    ]);
    const store = await seed(profiles);

    // SMA(3) over [10,20,30] = 20 — the instance resolves through the store's lazy view.
    expect(
      await store.series(SYMBOL, PERIOD, 'sma-inst', 'value', NO_UPPER_BOUND).asOf(NO_UPPER_BOUND),
    ).toEqual({
      ts: 180_000,
      value: { type: StateValueType.Number, value: 20 },
    });
  });

  it('does not register the instances of a disabled profile so its series stays empty', async () => {
    const profiles = new InMemoryProfileRepository([
      profile({
        id: 'p-off',
        enabled: false,
        indicators: [
          {
            id: 'sma-inst',
            indicatorKey: 'sma',
            version: 1,
            inputs: { length: 3, source: 'close' },
          },
        ],
      }),
    ]);
    const store = await seed(profiles);

    expect(
      await store.series(SYMBOL, PERIOD, 'sma-inst', 'value', NO_UPPER_BOUND).asOf(NO_UPPER_BOUND),
    ).toBeNull();
  });
});
