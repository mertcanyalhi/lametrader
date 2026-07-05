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
import { warmIndicatorStore } from './warm-indicator-store.js';

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
  chartStates: [],
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

describe('warmIndicatorStore', () => {
  it('warms each enabled profile instance across its in-scope symbols and their watched periods', async () => {
    const candles = new InMemoryCandleRepository();
    const bars = [10, 20, 30].map((c, i) => candle((i + 1) * 60_000, c));
    await candles.save('BTC', Period.OneMinute, bars);
    await candles.save('BTC', Period.OneHour, bars);

    const watchlist = new InMemoryWatchlistRepository([
      {
        id: 'BTC',
        type: SymbolType.Crypto,
        description: 'BTC',
        exchange: 'Binance',
        periods: [Period.OneMinute, Period.OneHour],
      },
    ]);
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
    const store = new IndicatorSeriesStore(
      new IndicatorService(defaultIndicators(), watchlist, candles),
    );

    await warmIndicatorStore({ store, profiles, watchlist });

    // SMA(3) over [10,20,30] = 20, warmed independently at each watched period.
    expect({
      minute: store.latest('BTC', Period.OneMinute, 'sma-inst', 'value'),
      hour: store.latest('BTC', Period.OneHour, 'sma-inst', 'value'),
    }).toEqual({
      minute: { type: StateValueType.Number, value: 20 },
      hour: { type: StateValueType.Number, value: 20 },
    });
  });

  it('skips an instance whose indicator does not apply to a symbol asset class without warming it', async () => {
    const candles = new InMemoryCandleRepository();
    const bars = [10, 20, 30].map((c, i) => candle((i + 1) * 60_000, c));
    await candles.save('fx:EURUSD', Period.OneMinute, bars);

    const watchlist = new InMemoryWatchlistRepository([
      {
        id: 'fx:EURUSD',
        type: SymbolType.Fx,
        description: 'EURUSD',
        exchange: 'FX',
        periods: [Period.OneMinute],
      },
    ]);
    // vwma consumes volume so it excludes Fx (appliesTo has no Fx).
    const profiles = new InMemoryProfileRepository([
      profile({
        id: 'p1',
        indicators: [{ id: 'vwma-inst', indicatorKey: 'vwma', version: 1, inputs: { length: 3 } }],
      }),
    ]);
    const store = new IndicatorSeriesStore(
      new IndicatorService(defaultIndicators(), watchlist, candles),
    );

    await warmIndicatorStore({ store, profiles, watchlist });

    expect(store.latest('fx:EURUSD', Period.OneMinute, 'vwma-inst', 'value')).toBeNull();
  });

  it('does not warm instances of a disabled profile', async () => {
    const candles = new InMemoryCandleRepository();
    const bars = [10, 20, 30].map((c, i) => candle((i + 1) * 60_000, c));
    await candles.save('BTC', Period.OneMinute, bars);

    const watchlist = new InMemoryWatchlistRepository([
      {
        id: 'BTC',
        type: SymbolType.Crypto,
        description: 'BTC',
        exchange: 'Binance',
        periods: [Period.OneMinute],
      },
    ]);
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
    const store = new IndicatorSeriesStore(
      new IndicatorService(defaultIndicators(), watchlist, candles),
    );

    await warmIndicatorStore({ store, profiles, watchlist });

    expect(store.latest('BTC', Period.OneMinute, 'sma-inst', 'value')).toBeNull();
  });
});
