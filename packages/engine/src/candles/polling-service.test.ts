import {
  type BackfillRange,
  type Candle,
  type CryptoCandle,
  type Instrument,
  MarketDataError,
  type MarketDataSource,
  Period,
  SymbolType,
  type WatchedSymbol,
} from '@lametrader/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryWatchlistRepository } from '../symbols/in-memory-watchlist-repository.js';
import { InMemoryCandleRepository } from './in-memory-candle-repository.js';
import { PollingService } from './polling-service.js';
import type { CandleEvent } from './polling-service.types.js';

/** Watched crypto symbols (period 1h). */
const BTC: WatchedSymbol = {
  id: 'crypto:BTCUSDT',
  type: SymbolType.Crypto,
  description: 'BTC / USDT',
  exchange: 'Binance',
  currency: 'USDT',
  periods: [Period.OneHour],
};
const ETH: WatchedSymbol = { ...BTC, id: 'crypto:ETHUSDT', description: 'ETH / USDT' };

/** Build a deterministic crypto candle at `time`. */
const candle = (time: number): CryptoCandle => ({
  type: SymbolType.Crypto,
  time,
  open: 1,
  high: 2,
  low: 0.5,
  close: 1.5,
  volume: 10,
  quoteVolume: 15,
  trades: 3,
});

/** One hour in ms — the period under test. */
const HOUR = 3_600_000;
/** A fixed clock so resume windows and `final` flags are deterministic. */
const NOW = 8_000_000;

/**
 * A {@link MarketDataSource} that records its `fetchCandles` calls and serves a
 * per-id seeded series, throwing for ids listed in `failing`.
 */
class RecordingSource implements MarketDataSource {
  readonly types = [SymbolType.Crypto];
  readonly calls: Array<{ id: string; period: Period; range?: BackfillRange }> = [];

  constructor(
    private readonly series: Record<string, Candle[]>,
    private readonly failing: string[] = [],
  ) {}

  async search(): Promise<Instrument[]> {
    return [];
  }
  async lookup(): Promise<Instrument | null> {
    return null;
  }
  async fetchCandles(id: string, period: Period, range?: BackfillRange): Promise<Candle[]> {
    this.calls.push({ id, period, range });
    if (this.failing.includes(id)) {
      throw new MarketDataError(`source failed for ${id}`);
    }
    const all = this.series[id] ?? [];
    if (!range) return [...all];
    return all.filter((c) => c.time >= range.from && c.time < range.to);
  }
}

/** A full per-period interval record with every period set to `ms`. */
const allIntervals = (ms: number): Record<Period, number> =>
  Object.fromEntries(Object.values(Period).map((p) => [p, ms])) as Record<Period, number>;

describe('PollingService.poll', () => {
  let repo: InMemoryCandleRepository;

  beforeEach(() => {
    repo = new InMemoryCandleRepository();
  });

  it('resumes from latest: fetches { from: latest.time, to: now }, persists the result', async () => {
    await repo.save(BTC.id, Period.OneHour, [candle(0)]);
    const source = new RecordingSource({ [BTC.id]: [candle(0), candle(HOUR), candle(2 * HOUR)] });
    const service = new PollingService([source], repo, new InMemoryWatchlistRepository([BTC]), {
      onCandle: () => {},
      intervals: allIntervals(1000),
      now: () => NOW,
    });

    await service.poll();

    expect(source.calls).toEqual([
      { id: BTC.id, period: Period.OneHour, range: { from: 0, to: NOW } },
    ]);
    expect(await repo.range(BTC.id, Period.OneHour, 0, Number.MAX_SAFE_INTEGER)).toEqual([
      candle(0),
      candle(HOUR),
      candle(2 * HOUR),
    ]);
  });

  it('emits one CandleEvent per fetched candle, final when the bar has closed', async () => {
    await repo.save(BTC.id, Period.OneHour, [candle(0)]);
    const source = new RecordingSource({ [BTC.id]: [candle(0), candle(HOUR), candle(2 * HOUR)] });
    const events: CandleEvent[] = [];
    const service = new PollingService([source], repo, new InMemoryWatchlistRepository([BTC]), {
      onCandle: (e) => events.push(e),
      intervals: allIntervals(1000),
      now: () => NOW,
    });

    await service.poll();

    expect(events).toEqual([
      { id: BTC.id, period: Period.OneHour, candle: candle(0), final: true },
      { id: BTC.id, period: Period.OneHour, candle: candle(HOUR), final: true },
      { id: BTC.id, period: Period.OneHour, candle: candle(2 * HOUR), final: false },
    ]);
  });

  it('skips a symbol+period with no stored candles (no fetch, no emit)', async () => {
    const source = new RecordingSource({ [BTC.id]: [candle(0), candle(HOUR)] });
    const events: CandleEvent[] = [];
    const service = new PollingService([source], repo, new InMemoryWatchlistRepository([BTC]), {
      onCandle: (e) => events.push(e),
      intervals: allIntervals(1000),
      now: () => NOW,
    });

    await service.poll();

    expect(source.calls).toEqual([]);
    expect(events).toEqual([]);
    expect(await repo.range(BTC.id, Period.OneHour, 0, Number.MAX_SAFE_INTEGER)).toEqual([]);
  });

  it('catches a MarketDataError on one symbol and still polls the others', async () => {
    await repo.save(BTC.id, Period.OneHour, [candle(0)]);
    await repo.save(ETH.id, Period.OneHour, [candle(0)]);
    const source = new RecordingSource({ [BTC.id]: [candle(0), candle(HOUR)] }, [ETH.id]);
    const events: CandleEvent[] = [];
    const service = new PollingService(
      [source],
      repo,
      new InMemoryWatchlistRepository([ETH, BTC]),
      { onCandle: (e) => events.push(e), intervals: allIntervals(1000), now: () => NOW },
    );

    await expect(service.poll()).resolves.toBeUndefined();

    expect(events).toEqual([
      { id: BTC.id, period: Period.OneHour, candle: candle(0), final: true },
      { id: BTC.id, period: Period.OneHour, candle: candle(HOUR), final: true },
    ]);
    expect(await repo.range(BTC.id, Period.OneHour, 0, Number.MAX_SAFE_INTEGER)).toEqual([
      candle(0),
      candle(HOUR),
    ]);
  });
});

describe('PollingService start/stop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls a period at its configured interval and stops after stop()', async () => {
    const repo = new InMemoryCandleRepository();
    await repo.save(BTC.id, Period.OneHour, [candle(0)]);
    const source = new RecordingSource({ [BTC.id]: [candle(0), candle(HOUR)] });
    const intervals = allIntervals(10_000);
    intervals[Period.OneHour] = 1000;
    const service = new PollingService([source], repo, new InMemoryWatchlistRepository([BTC]), {
      onCandle: () => {},
      intervals,
      now: () => NOW,
      random: () => 0,
    });

    service.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(source.calls).toEqual([
      { id: BTC.id, period: Period.OneHour, range: { from: 0, to: NOW } },
    ]);

    service.stop();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(source.calls).toEqual([
      { id: BTC.id, period: Period.OneHour, range: { from: 0, to: NOW } },
    ]);
  });
});
