import {
  type Candle,
  IndicatorError,
  IndicatorNotFoundError,
  type IndicatorStateEvent,
  Period,
  SymbolNotFoundError,
  SymbolType,
  type WatchedSymbol,
} from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { InMemoryCandleRepository } from '../candles/in-memory-candle-repository.js';
import type { CandleEvent } from '../candles/polling-service.types.js';
import { InMemoryWatchlistRepository } from '../symbols/in-memory-watchlist-repository.js';
import { defaultIndicators } from './default-indicators.js';
import { IndicatorComputeService } from './indicator-compute-service.js';
import { IndicatorStreamService } from './indicator-stream-service.js';

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

/** Deterministic subscription-id generator: s1, s2, … */
function sequentialIds(): () => string {
  let n = 0;
  return () => `s${++n}`;
}

/**
 * Build a stream service backed by in-memory repos seeded with BTC + EURUSD watched.
 * Five SMA-friendly candles are stored on BTC@1h.
 */
async function build() {
  const registry = defaultIndicators();
  const watchlist = new InMemoryWatchlistRepository([BTC, EURUSD]);
  const candles = new InMemoryCandleRepository();
  await candles.save(
    BTC.id,
    Period.OneHour,
    [10, 20, 30, 40, 50].map((c, i) => candle(i, c)),
  );
  const compute = new IndicatorComputeService(registry, watchlist, candles);
  const events: IndicatorStateEvent[] = [];
  const stream = new IndicatorStreamService(registry, watchlist, compute, {
    onState: (event) => events.push(event),
    newId: sequentialIds(),
  });
  return { stream, events, candles };
}

describe('IndicatorStreamService.subscribe', () => {
  it('returns the generated subscriptionId for a valid config', async () => {
    const { stream } = await build();
    const subscriptionId = await stream.subscribe({
      id: BTC.id,
      period: Period.OneHour,
      indicatorKey: 'sma',
      inputs: { length: 3 },
    });
    expect(subscriptionId).toEqual('s1');
  });

  it('throws SymbolNotFoundError for an unwatched symbol', async () => {
    const { stream } = await build();
    await expect(
      stream.subscribe({
        id: 'crypto:UNWATCHED',
        period: Period.OneHour,
        indicatorKey: 'sma',
        inputs: { length: 3 },
      }),
    ).rejects.toBeInstanceOf(SymbolNotFoundError);
  });

  it('throws IndicatorNotFoundError for an unknown indicator key', async () => {
    const { stream } = await build();
    await expect(
      stream.subscribe({
        id: BTC.id,
        period: Period.OneHour,
        indicatorKey: 'bogus',
        inputs: {},
      }),
    ).rejects.toBeInstanceOf(IndicatorNotFoundError);
  });

  it('throws IndicatorError on asset-class mismatch (FX + volume-based indicator)', async () => {
    const { stream } = await build();
    await expect(
      stream.subscribe({
        id: EURUSD.id,
        period: Period.OneHour,
        indicatorKey: 'vwma',
        inputs: {},
      }),
    ).rejects.toBeInstanceOf(IndicatorError);
  });

  it('throws IndicatorError on invalid inputs', async () => {
    const { stream } = await build();
    await expect(
      stream.subscribe({
        id: BTC.id,
        period: Period.OneHour,
        indicatorKey: 'sma',
        inputs: { length: 0 },
      }),
    ).rejects.toBeInstanceOf(IndicatorError);
  });
});

describe('IndicatorStreamService.handleCandle', () => {
  it('emits one event per matching subscription with the latest state point', async () => {
    const { stream, events } = await build();
    const subscriptionId = await stream.subscribe({
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

    await stream.handleCandle(event);

    // SMA(3) at time=4 over closes [10,20,30,40,50] is mean(30,40,50)=40.
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

  it('mirrors the forming candles `final: false`', async () => {
    const { stream, events } = await build();
    await stream.subscribe({
      id: BTC.id,
      period: Period.OneHour,
      indicatorKey: 'sma',
      inputs: { length: 3 },
    });
    const event: CandleEvent = {
      id: BTC.id,
      period: Period.OneHour,
      candle: candle(4, 50),
      final: false,
    };

    await stream.handleCandle(event);

    expect(events[0]?.final).toEqual(false);
  });

  it('emits nothing when no subscription matches the (id, period)', async () => {
    const { stream, events } = await build();
    await stream.subscribe({
      id: BTC.id,
      period: Period.OneHour,
      indicatorKey: 'sma',
      inputs: { length: 3 },
    });
    await stream.handleCandle({
      id: 'crypto:ETHUSDT',
      period: Period.OneHour,
      candle: candle(4, 50),
      final: true,
    });
    expect(events).toEqual([]);
  });

  it('emits one event per subscription when two subscriptions match (id, period)', async () => {
    const { stream, events } = await build();
    const a = await stream.subscribe({
      id: BTC.id,
      period: Period.OneHour,
      indicatorKey: 'sma',
      inputs: { length: 3 },
    });
    const b = await stream.subscribe({
      id: BTC.id,
      period: Period.OneHour,
      indicatorKey: 'sma',
      inputs: { length: 5 },
    });

    await stream.handleCandle({
      id: BTC.id,
      period: Period.OneHour,
      candle: candle(4, 50),
      final: true,
    });

    expect(events.map((e) => e.subscriptionId).sort()).toEqual([a, b].sort());
  });

  it('confirmed live state at a candles time equals IndicatorComputeService.compute (consistency)', async () => {
    const { stream, events, candles } = await build();
    const registry = defaultIndicators();
    const watchlist = new InMemoryWatchlistRepository([BTC]);
    const compute = new IndicatorComputeService(registry, watchlist, candles);
    await stream.subscribe({
      id: BTC.id,
      period: Period.OneHour,
      indicatorKey: 'sma',
      inputs: { length: 3 },
    });

    await stream.handleCandle({
      id: BTC.id,
      period: Period.OneHour,
      candle: candle(4, 50),
      final: true,
    });

    const historical = await compute.compute(BTC.id, 'sma', { length: 3 }, Period.OneHour, {
      from: 4,
      to: 5,
    });
    expect(events[0]?.state).toEqual(historical.state[0]);
  });
});

describe('IndicatorStreamService.unsubscribe', () => {
  it('stops emitting events for the unsubscribed id', async () => {
    const { stream, events } = await build();
    const subscriptionId = await stream.subscribe({
      id: BTC.id,
      period: Period.OneHour,
      indicatorKey: 'sma',
      inputs: { length: 3 },
    });
    stream.unsubscribe(subscriptionId);
    await stream.handleCandle({
      id: BTC.id,
      period: Period.OneHour,
      candle: candle(4, 50),
      final: true,
    });
    expect(events).toEqual([]);
  });

  it('is a no-op for an unknown subscriptionId', async () => {
    const { stream } = await build();
    expect(() => stream.unsubscribe('unknown')).not.toThrow();
  });
});
