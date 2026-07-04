import {
  type Candle,
  type IndicatorStateEvent,
  Period,
  periodMillis,
  SymbolType,
  type WatchedSymbol,
} from '@lametrader/core';
import { InMemoryCandleRepository } from '../candles/in-memory-candle.repository.js';
import type { CandleEvent } from '../candles/polling.service.types.js';
import { IndicatorError, IndicatorNotFoundError } from '../domain/indicator.js';
import { SymbolNotFoundError } from '../domain/symbol.js';
import { InMemoryWatchlistRepository } from '../watchlist/in-memory-watchlist.repository.js';
import { defaultIndicators } from './default-indicators.js';
import { defineIndicator } from './define-indicator.js';
import { IndicatorService } from './indicator.service.js';
import { IndicatorRegistry } from './indicator-registry.js';

const BTC: WatchedSymbol = {
  id: 'crypto:BTCUSDT',
  type: SymbolType.Crypto,
  description: 'Bitcoin',
  exchange: 'Binance',
  periods: [Period.OneHour],
};

const EURUSD: WatchedSymbol = {
  id: 'fx:EURUSD',
  type: SymbolType.Fx,
  description: 'Euro / USD',
  exchange: 'OANDA',
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

function sequentialIds(): () => string {
  let n = 0;
  return () => `s${++n}`;
}

async function build() {
  const watchlist = new InMemoryWatchlistRepository([BTC, EURUSD]);
  const candles = new InMemoryCandleRepository();
  const events: IndicatorStateEvent[] = [];
  const service = new IndicatorService(defaultIndicators(), watchlist, candles, {
    onState: (event) => events.push(event),
    newId: sequentialIds(),
  });
  return { service, watchlist, candles, events };
}

describe('IndicatorService.compute — validation', () => {
  it('throws SymbolNotFoundError when the symbol is not watched', async () => {
    const { service } = await build();
    await expect(
      service.compute('crypto:UNWATCHED', 'sma', {}, Period.OneHour),
    ).rejects.toBeInstanceOf(SymbolNotFoundError);
  });

  it('throws IndicatorNotFoundError when the indicator key is unknown', async () => {
    const { service } = await build();
    await expect(service.compute(BTC.id, 'bogus', {}, Period.OneHour)).rejects.toBeInstanceOf(
      IndicatorNotFoundError,
    );
  });

  it('throws IndicatorError on asset-class mismatch', async () => {
    const { service } = await build();
    await expect(service.compute(EURUSD.id, 'vwma', {}, Period.OneHour)).rejects.toBeInstanceOf(
      IndicatorError,
    );
  });

  it('throws IndicatorError on invalid inputs', async () => {
    const { service } = await build();
    await expect(
      service.compute(BTC.id, 'sma', { length: 0 }, Period.OneHour),
    ).rejects.toBeInstanceOf(IndicatorError);
  });
});

describe('IndicatorService.compute — happy path', () => {
  it('returns the aligned SMA(3) series for a watched symbol with 5 stored candles', async () => {
    const { service, candles } = await build();
    await candles.save(
      BTC.id,
      Period.OneHour,
      [10, 20, 30, 40, 50].map((c, i) => candle(i, c)),
    );

    const result = await service.compute(BTC.id, 'sma', { length: 3 }, Period.OneHour);

    expect(result).toEqual({
      indicatorKey: 'sma',
      version: 1,
      period: Period.OneHour,
      state: [
        { time: 0, value: null },
        { time: 1, value: null },
        { time: 2, value: expect.closeTo(20, 6) },
        { time: 3, value: expect.closeTo(30, 6) },
        { time: 4, value: expect.closeTo(40, 6) },
      ],
    });
  });

  it('slices the result to [from, to) and the first row past warm-up is already warm', async () => {
    const { service, candles } = await build();
    await candles.save(
      BTC.id,
      Period.OneHour,
      [10, 20, 30, 40, 50].map((c, i) => candle(i, c)),
    );

    const result = await service.compute(BTC.id, 'sma', { length: 3 }, Period.OneHour, {
      from: 3,
      to: 5,
    });

    expect(result.state).toEqual([
      { time: 3, value: expect.closeTo(30, 6) },
      { time: 4, value: expect.closeTo(40, 6) },
    ]);
  });

  it('warms up by candle count, not calendar span, so a single-bar request on a gapped series is non-null', async () => {
    const { service, candles } = await build();
    const day = periodMillis(Period.OneDay);
    await candles.save(
      BTC.id,
      Period.OneDay,
      [0, 1, 2, 3, 4, 7].map((d) => candle(d * day, 10 + d)),
    );

    const result = await service.compute(BTC.id, 'sma', { length: 5 }, Period.OneDay, {
      from: 7 * day,
      to: 7 * day + 1,
    });

    expect(result.state).toEqual([{ time: 7 * day, value: expect.closeTo(13.4, 6) }]);
  });

  it('loads exactly `[from, to)` when the module declares no warm-up', async () => {
    const watchlist = new InMemoryWatchlistRepository([BTC]);
    const candles = new InMemoryCandleRepository();
    const registry = new IndicatorRegistry();
    registry.register(
      defineIndicator({
        key: 'noop',
        name: 'No-op',
        description: '',
        version: 1,
        inputs: [] as const,
        state: [] as const,
        summary: () => 'noop',
        compute: (_inputs, candleArray) => candleArray.map((c) => ({ time: c.time })),
      }),
    );
    await candles.save(BTC.id, Period.OneHour, [candle(1_500_000, 100)]);
    const service = new IndicatorService(registry, watchlist, candles);
    const spy = jest.spyOn(candles, 'range');

    await service.compute(BTC.id, 'noop', {}, Period.OneHour, {
      from: 1_000_000,
      to: 2_000_000,
    });

    expect(spy.mock.calls).toEqual([[BTC.id, Period.OneHour, 1_000_000, 2_000_000]]);
  });

  it('loads the full stored series when neither `from` nor `to` is supplied', async () => {
    const { service, candles } = await build();
    const spy = jest.spyOn(candles, 'range');
    await candles.save(BTC.id, Period.OneHour, [candle(0, 100)]);

    await service.compute(BTC.id, 'sma', { length: 14 }, Period.OneHour);

    expect(spy.mock.calls).toEqual([[BTC.id, Period.OneHour, 0, Number.MAX_SAFE_INTEGER]]);
  });
});

describe('IndicatorService.subscribe — validation parity with compute', () => {
  it('returns the generated subscriptionId for a valid config', async () => {
    const { service } = await build();
    const subscriptionId = await service.subscribe({
      id: BTC.id,
      period: Period.OneHour,
      indicatorKey: 'sma',
      inputs: { length: 3 },
    });
    expect(subscriptionId).toEqual('s1');
  });

  it('throws SymbolNotFoundError for an unwatched symbol', async () => {
    const { service } = await build();
    await expect(
      service.subscribe({
        id: 'crypto:UNWATCHED',
        period: Period.OneHour,
        indicatorKey: 'sma',
        inputs: { length: 3 },
      }),
    ).rejects.toBeInstanceOf(SymbolNotFoundError);
  });

  it('throws IndicatorNotFoundError for an unknown indicator key', async () => {
    const { service } = await build();
    await expect(
      service.subscribe({
        id: BTC.id,
        period: Period.OneHour,
        indicatorKey: 'bogus',
        inputs: {},
      }),
    ).rejects.toBeInstanceOf(IndicatorNotFoundError);
  });

  it('throws IndicatorError on asset-class mismatch', async () => {
    const { service } = await build();
    await expect(
      service.subscribe({
        id: EURUSD.id,
        period: Period.OneHour,
        indicatorKey: 'vwma',
        inputs: {},
      }),
    ).rejects.toBeInstanceOf(IndicatorError);
  });

  it('throws IndicatorError on invalid inputs', async () => {
    const { service } = await build();
    await expect(
      service.subscribe({
        id: BTC.id,
        period: Period.OneHour,
        indicatorKey: 'sma',
        inputs: { length: 0 },
      }),
    ).rejects.toBeInstanceOf(IndicatorError);
  });
});

describe('IndicatorService.subscribe + handleCandle — live path', () => {
  it('emits one event per matching subscription with the latest state point', async () => {
    const { service, events, candles } = await build();
    await candles.save(
      BTC.id,
      Period.OneHour,
      [10, 20, 30, 40, 50].map((c, i) => candle(i, c)),
    );
    const subscriptionId = await service.subscribe({
      id: BTC.id,
      period: Period.OneHour,
      indicatorKey: 'sma',
      inputs: { length: 3 },
    });
    const event: CandleEvent = {
      id: BTC.id,
      period: Period.OneHour,
      candle: candle(4, 50),
      final: true,
    };

    await service.handleCandle(event);

    expect(events).toEqual([
      {
        subscriptionId,
        id: BTC.id,
        period: Period.OneHour,
        indicatorKey: 'sma',
        state: { time: 4, value: expect.closeTo(40, 6) },
        final: true,
      },
    ]);
  });

  it('mirrors the forming candle final flag onto the emitted state event', async () => {
    const { service, events, candles } = await build();
    await candles.save(
      BTC.id,
      Period.OneHour,
      [10, 20, 30, 40, 50].map((c, i) => candle(i, c)),
    );
    await service.subscribe({
      id: BTC.id,
      period: Period.OneHour,
      indicatorKey: 'sma',
      inputs: { length: 3 },
    });

    await service.handleCandle({
      id: BTC.id,
      period: Period.OneHour,
      candle: candle(4, 50),
      final: false,
    });

    expect(events[0]?.final).toEqual(false);
  });

  it('fans each recomputed state to an added listener alongside the base sink', async () => {
    const { service, events, candles } = await build();
    await candles.save(
      BTC.id,
      Period.OneHour,
      [10, 20, 30, 40, 50].map((c, i) => candle(i, c)),
    );
    const subscriptionId = await service.subscribe({
      id: BTC.id,
      period: Period.OneHour,
      indicatorKey: 'sma',
      inputs: { length: 3 },
    });
    const cascaded: IndicatorStateEvent[] = [];
    service.addStateListener((event) => cascaded.push(event));

    await service.handleCandle({
      id: BTC.id,
      period: Period.OneHour,
      candle: candle(4, 50),
      final: true,
    });

    const expected: IndicatorStateEvent[] = [
      {
        subscriptionId,
        id: BTC.id,
        period: Period.OneHour,
        indicatorKey: 'sma',
        state: { time: 4, value: expect.closeTo(40, 6) },
        final: true,
      },
    ];
    // Base sink (the `/stream` hub) and the added cascade sink both fire, in order.
    expect(events).toEqual(expected);
    expect(cascaded).toEqual(expected);
  });

  it('stops delivering to a state listener once its unsubscribe is called', async () => {
    const { service, candles } = await build();
    await candles.save(
      BTC.id,
      Period.OneHour,
      [10, 20, 30, 40, 50].map((c, i) => candle(i, c)),
    );
    await service.subscribe({
      id: BTC.id,
      period: Period.OneHour,
      indicatorKey: 'sma',
      inputs: { length: 3 },
    });
    const cascaded: IndicatorStateEvent[] = [];
    const detach = service.addStateListener((event) => cascaded.push(event));
    detach();

    await service.handleCandle({
      id: BTC.id,
      period: Period.OneHour,
      candle: candle(4, 50),
      final: true,
    });

    expect(cascaded).toEqual([]);
  });

  it('emits nothing when no subscription matches (id, period)', async () => {
    const { service, events, candles } = await build();
    await candles.save(
      BTC.id,
      Period.OneHour,
      [10, 20, 30, 40, 50].map((c, i) => candle(i, c)),
    );
    await service.subscribe({
      id: BTC.id,
      period: Period.OneHour,
      indicatorKey: 'sma',
      inputs: { length: 3 },
    });
    await service.handleCandle({
      id: 'crypto:ETHUSDT',
      period: Period.OneHour,
      candle: candle(4, 50),
      final: true,
    });
    expect(events).toEqual([]);
  });

  it('recomputes only the just-arrived bar (does NOT scan history)', async () => {
    const { service, candles } = await build();
    await candles.save(
      BTC.id,
      Period.OneHour,
      [10, 20, 30, 40, 50].map((c, i) => candle(i, c)),
    );
    const rangeSpy = jest.spyOn(candles, 'range');
    const latestNSpy = jest.spyOn(candles, 'latestN');
    await service.subscribe({
      id: BTC.id,
      period: Period.OneHour,
      indicatorKey: 'sma',
      inputs: { length: 3 },
    });

    await service.handleCandle({
      id: BTC.id,
      period: Period.OneHour,
      candle: candle(4, 50),
      final: true,
    });

    expect(rangeSpy.mock.calls).toEqual([[BTC.id, Period.OneHour, 4, 5]]);
    expect(latestNSpy.mock.calls).toEqual([[BTC.id, Period.OneHour, 3, 4]]);
  });
});

describe('IndicatorService.unsubscribe', () => {
  it('stops emitting events for the unsubscribed id', async () => {
    const { service, events, candles } = await build();
    await candles.save(
      BTC.id,
      Period.OneHour,
      [10, 20, 30, 40, 50].map((c, i) => candle(i, c)),
    );
    const subscriptionId = await service.subscribe({
      id: BTC.id,
      period: Period.OneHour,
      indicatorKey: 'sma',
      inputs: { length: 3 },
    });
    service.unsubscribe(subscriptionId);
    await service.handleCandle({
      id: BTC.id,
      period: Period.OneHour,
      candle: candle(4, 50),
      final: true,
    });
    expect(events).toEqual([]);
  });

  it('is a no-op for an unknown subscriptionId', async () => {
    const { service } = await build();
    expect(() => service.unsubscribe('unknown')).not.toThrow();
  });
});
