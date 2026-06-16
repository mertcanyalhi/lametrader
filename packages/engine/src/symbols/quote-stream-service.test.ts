import {
  type Candle,
  type Config,
  computeQuote,
  Period,
  type Period as PeriodType,
  SymbolError,
  SymbolNotFoundError,
  type SymbolQuoteEvent,
  SymbolType,
  type WatchedSymbol,
} from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { InMemoryCandleRepository } from '../candles/in-memory-candle-repository.js';
import type { CandleEvent } from '../candles/polling-service.types.js';
import { ConfigService } from '../config/config-service.js';
import { InMemoryMarketDataSource } from './in-memory-market-data-source.js';
import { InMemoryWatchlistRepository } from './in-memory-watchlist-repository.js';
import { QuoteStreamService } from './quote-stream-service.js';
import { SymbolService } from './symbol-service.js';

/** One hour in ms. */
const HOUR = 3_600_000;

/** BTC instrument (periods filled in per build). */
const BTC = {
  id: 'crypto:BTCUSDT',
  type: SymbolType.Crypto,
  description: 'Bitcoin',
  exchange: 'Binance',
  currency: 'USDT',
};

/** Build a crypto candle at `time` closing at `close`. */
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

/** A ConfigService whose stored config is fixed. */
function configService(periods: PeriodType[], defaultPeriod: PeriodType): ConfigService {
  const stored: Config = { periods, defaultPeriod };
  return new ConfigService({ load: async () => stored, save: async () => {} });
}

/**
 * Build a quote-stream service over in-memory repos: BTC watched on `symbolPeriods`,
 * config `periods`/`defaultPeriod`, and `seed` candles stored on `seedPeriod`.
 */
async function build(
  options: {
    symbolPeriods?: PeriodType[];
    periods?: PeriodType[];
    defaultPeriod?: PeriodType;
    seed?: Candle[];
    seedPeriod?: PeriodType;
  } = {},
) {
  const symbolPeriods = options.symbolPeriods ?? [Period.OneHour];
  const periods = options.periods ?? [Period.OneHour];
  const defaultPeriod = options.defaultPeriod ?? Period.OneHour;
  const seed = options.seed ?? [candle(0, 100), candle(HOUR, 110)];
  const seedPeriod = options.seedPeriod ?? Period.OneHour;

  const watched: WatchedSymbol = { ...BTC, periods: symbolPeriods };
  const watchlist = new InMemoryWatchlistRepository([watched]);
  const candles = new InMemoryCandleRepository();
  if (seed.length > 0) await candles.save(BTC.id, seedPeriod, seed);
  const config = configService(periods, defaultPeriod);
  const events: SymbolQuoteEvent[] = [];
  const stream = new QuoteStreamService(watchlist, config, candles, {
    onQuote: (event) => events.push(event),
    newId: sequentialIds(),
  });
  return { stream, events, candles, watchlist, config };
}

describe('QuoteStreamService.subscribe', () => {
  it('returns the generated subscriptionId and resolved period for a valid symbol', async () => {
    const { stream } = await build();
    expect(await stream.subscribe(BTC.id)).toEqual({
      subscriptionId: 's1',
      period: Period.OneHour,
    });
  });

  it('throws SymbolNotFoundError for an unwatched symbol', async () => {
    const { stream } = await build();
    await expect(stream.subscribe('crypto:UNWATCHED')).rejects.toBeInstanceOf(SymbolNotFoundError);
  });

  it('throws SymbolError when the symbol does not watch the defaultPeriod', async () => {
    const { stream } = await build({
      symbolPeriods: [Period.OneHour],
      periods: [Period.OneHour, Period.OneDay],
      defaultPeriod: Period.OneDay,
    });
    await expect(stream.subscribe(BTC.id)).rejects.toBeInstanceOf(SymbolError);
  });

  it('throws SymbolError when fewer than two candles are stored on the defaultPeriod', async () => {
    const { stream } = await build({ seed: [candle(0, 100)] });
    await expect(stream.subscribe(BTC.id)).rejects.toBeInstanceOf(SymbolError);
  });
});

describe('QuoteStreamService.handleCandle', () => {
  it('emits one quote event per matching subscription, mirroring the candle final flag', async () => {
    const { stream, events } = await build();
    const { subscriptionId } = await stream.subscribe(BTC.id);
    const event: CandleEvent = {
      id: BTC.id,
      period: Period.OneHour,
      candle: candle(HOUR, 115),
      final: false,
    };

    stream.handleCandle(event);

    // previous bar is the seeded candle(0, 100); change is 115 − 100 = 15.
    expect(events).toEqual([
      {
        subscriptionId,
        id: BTC.id,
        period: Period.OneHour,
        quote: {
          price: 115,
          change: expect.closeTo(15, 6),
          changePct: expect.closeTo(0.15, 6),
          time: HOUR,
        },
        final: false,
      },
    ]);
  });

  it('derives the next frame against the rotated previous close after a final candle', async () => {
    const { stream, events } = await build();
    await stream.subscribe(BTC.id);

    stream.handleCandle({
      id: BTC.id,
      period: Period.OneHour,
      candle: candle(HOUR, 110),
      final: true,
    });
    stream.handleCandle({
      id: BTC.id,
      period: Period.OneHour,
      candle: candle(2 * HOUR, 130),
      final: false,
    });

    // First frame: 110 − 100 = 10 (vs seeded previous). After final, previous rotates to 110;
    // second frame: 130 − 110 = 20, changePct 20/110.
    expect(events.map((e) => e.quote)).toEqual([
      { price: 110, change: expect.closeTo(10, 6), changePct: expect.closeTo(0.1, 6), time: HOUR },
      {
        price: 130,
        change: expect.closeTo(20, 6),
        changePct: expect.closeTo(0.181818, 6),
        time: 2 * HOUR,
      },
    ]);
  });

  it('emits nothing when no subscription matches the (id, period)', async () => {
    const { stream, events } = await build();
    await stream.subscribe(BTC.id);
    stream.handleCandle({
      id: 'crypto:ETHUSDT',
      period: Period.OneHour,
      candle: candle(HOUR, 115),
      final: true,
    });
    expect(events).toEqual([]);
  });

  it('matches IndicatorStreamService-style derivation: the live quote equals computeQuote(candle, previous)', async () => {
    const { stream, events } = await build();
    await stream.subscribe(BTC.id);
    const incoming = candle(2 * HOUR, 120);

    stream.handleCandle({ id: BTC.id, period: Period.OneHour, candle: incoming, final: false });

    expect(events[0]?.quote).toEqual(computeQuote(incoming, candle(0, 100)));
  });
});

describe('QuoteStreamService.unsubscribe', () => {
  it('stops emitting events for the unsubscribed subscription only', async () => {
    const { stream, events } = await build();
    const { subscriptionId } = await stream.subscribe(BTC.id);
    stream.unsubscribe(subscriptionId);
    stream.handleCandle({
      id: BTC.id,
      period: Period.OneHour,
      candle: candle(HOUR, 115),
      final: true,
    });
    expect(events).toEqual([]);
  });

  it('is a no-op for an unknown subscriptionId', async () => {
    const { stream } = await build();
    expect(() => stream.unsubscribe('unknown')).not.toThrow();
  });
});

describe('QuoteStreamService consistency with the #35 snapshot', () => {
  it('a final frame at a closed candles time carries the same price/change/changePct/time as listWithQuotes', async () => {
    const { stream, events, candles, watchlist, config } = await build();
    const symbols = new SymbolService(
      [new InMemoryMarketDataSource([BTC])],
      watchlist,
      config,
      candles,
    );

    // Snapshot quote for BTC: latest close 110, previous 100 → change 10, changePct 0.1, time HOUR.
    const snapshot = (await symbols.listWithQuotes())[0]?.quote;
    expect(snapshot).toEqual({
      price: 110,
      change: expect.closeTo(10, 6),
      changePct: expect.closeTo(0.1, 6),
      period: Period.OneHour,
      time: HOUR,
    });

    await stream.subscribe(BTC.id);
    // Re-emit of the latest closed bar (HOUR, 110) — the live final frame at its time.
    stream.handleCandle({
      id: BTC.id,
      period: Period.OneHour,
      candle: candle(HOUR, 110),
      final: true,
    });

    expect(events[0]?.quote).toEqual({
      price: 110,
      change: expect.closeTo(10, 6),
      changePct: expect.closeTo(0.1, 6),
      time: HOUR,
    });
  });
});
