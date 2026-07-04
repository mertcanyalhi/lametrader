import {
  type BackfillRange,
  type Candle,
  type CandleBatch,
  type CryptoCandle,
  type Instrument,
  type MarketDataSource,
  Period,
  SymbolType,
  type WatchedSymbol,
} from '@lametrader/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { MarketDataError } from '../../domain/symbol.js';
import type { CandleEvent } from '../interfaces/polling.service.types.js';
import { InMemoryCandleRepository } from '../persistence/in-memory-candle.repository.js';
import { InMemoryWatchlistRepository } from '../persistence/in-memory-watchlist.repository.js';
import { PollingService } from './polling.service.js';

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
  readonly periods = Object.values(Period);
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
  async fetchCandles(id: string, period: Period, range?: BackfillRange): Promise<CandleBatch> {
    this.calls.push({ id, period, range });
    if (this.failing.includes(id)) {
      throw new MarketDataError(`source failed for ${id}`);
    }
    const all = this.series[id] ?? [];
    const candles = range ? all.filter((c) => c.time >= range.from && c.time < range.to) : [...all];
    return { candles, complete: true };
  }
}

/** A full per-period interval record with every period set to `ms`. */
const allIntervals = (ms: number): Record<Period, number> =>
  Object.fromEntries(Object.values(Period).map((p) => [p, ms])) as Record<Period, number>;

describe('PollingService.poll', () => {
  let repo: InMemoryCandleRepository;
  let registry: SchedulerRegistry;

  beforeEach(() => {
    repo = new InMemoryCandleRepository();
    registry = new SchedulerRegistry();
  });

  it('resumes from latest: fetches { from: latest.time, to: now }, persists the result', async () => {
    await repo.save(BTC.id, Period.OneHour, [candle(0)]);
    const source = new RecordingSource({ [BTC.id]: [candle(0), candle(HOUR), candle(2 * HOUR)] });
    const service = new PollingService(
      [source],
      repo,
      new InMemoryWatchlistRepository([BTC]),
      registry,
      { onCandle: () => {}, intervals: allIntervals(1000), now: () => NOW },
    );

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

  it('re-fetches the resume bar and overwrites its partial data with the final values', async () => {
    // The forming H:00 bar was stored on an earlier poll with a partial close.
    const partialZero: CryptoCandle = { ...candle(0), close: 1.1 };
    await repo.save(BTC.id, Period.OneHour, [partialZero]);
    // A later poll lands in the next hour: the provider now returns H:00 closed
    // with its final close, plus the new H+1 bar.
    const finalZero: CryptoCandle = { ...candle(0), close: 1.9 };
    const source = new RecordingSource({ [BTC.id]: [finalZero, candle(HOUR)] });
    const service = new PollingService(
      [source],
      repo,
      new InMemoryWatchlistRepository([BTC]),
      registry,
      { onCandle: () => {}, intervals: allIntervals(1000), now: () => NOW },
    );

    await service.poll();

    expect(await repo.range(BTC.id, Period.OneHour, 0, Number.MAX_SAFE_INTEGER)).toEqual([
      finalZero,
      candle(HOUR),
    ]);
  });

  it('emits one CandleEvent per fetched candle, final when the bar has closed', async () => {
    await repo.save(BTC.id, Period.OneHour, [candle(0)]);
    const source = new RecordingSource({ [BTC.id]: [candle(0), candle(HOUR), candle(2 * HOUR)] });
    const events: CandleEvent[] = [];
    const service = new PollingService(
      [source],
      repo,
      new InMemoryWatchlistRepository([BTC]),
      registry,
      { onCandle: (e) => events.push(e), intervals: allIntervals(1000), now: () => NOW },
    );

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
    const service = new PollingService(
      [source],
      repo,
      new InMemoryWatchlistRepository([BTC]),
      registry,
      { onCandle: (e) => events.push(e), intervals: allIntervals(1000), now: () => NOW },
    );

    await service.poll();

    expect(source.calls).toEqual([]);
    expect(events).toEqual([]);
    expect(await repo.range(BTC.id, Period.OneHour, 0, Number.MAX_SAFE_INTEGER)).toEqual([]);
  });

  it('fans each polled candle to an added listener alongside the base sink', async () => {
    await repo.save(BTC.id, Period.OneHour, [candle(0)]);
    const source = new RecordingSource({ [BTC.id]: [candle(0), candle(HOUR)] });
    const base: CandleEvent[] = [];
    const cascaded: CandleEvent[] = [];
    const service = new PollingService(
      [source],
      repo,
      new InMemoryWatchlistRepository([BTC]),
      registry,
      { onCandle: (e) => base.push(e), intervals: allIntervals(1000), now: () => NOW },
    );
    service.addCandleListener((e) => cascaded.push(e));

    await service.poll();

    const expected: CandleEvent[] = [
      { id: BTC.id, period: Period.OneHour, candle: candle(0), final: true },
      { id: BTC.id, period: Period.OneHour, candle: candle(HOUR), final: true },
    ];
    // Base sink (the `/stream` candle hub) and the added cascade sink both fire, in order.
    expect(base).toEqual(expected);
    expect(cascaded).toEqual(expected);
  });

  it('stops delivering to a candle listener once its unsubscribe is called', async () => {
    await repo.save(BTC.id, Period.OneHour, [candle(0)]);
    const source = new RecordingSource({ [BTC.id]: [candle(0), candle(HOUR)] });
    const cascaded: CandleEvent[] = [];
    const service = new PollingService(
      [source],
      repo,
      new InMemoryWatchlistRepository([BTC]),
      registry,
      { onCandle: () => {}, intervals: allIntervals(1000), now: () => NOW },
    );
    const detach = service.addCandleListener((e) => cascaded.push(e));
    detach();

    await service.poll();

    expect(cascaded).toEqual([]);
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
      registry,
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
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('is dormant on construction: schedules no timeout until start() is called', () => {
    const registry = new SchedulerRegistry();
    new PollingService(
      [new RecordingSource({})],
      new InMemoryCandleRepository(),
      new InMemoryWatchlistRepository([BTC]),
      registry,
      { onCandle: () => {}, intervals: allIntervals(1000), now: () => NOW, random: () => 0 },
    );

    expect(registry.getTimeouts()).toEqual([]);
  });

  it('polls a period at its configured interval and stops after stop()', async () => {
    const repo = new InMemoryCandleRepository();
    await repo.save(BTC.id, Period.OneHour, [candle(0)]);
    const source = new RecordingSource({ [BTC.id]: [candle(0), candle(HOUR)] });
    const intervals = allIntervals(10_000);
    intervals[Period.OneHour] = 1000;
    const service = new PollingService(
      [source],
      repo,
      new InMemoryWatchlistRepository([BTC]),
      new SchedulerRegistry(),
      { onCandle: () => {}, intervals, now: () => NOW, random: () => 0 },
    );

    service.start();
    await jest.advanceTimersByTimeAsync(1000);

    expect(source.calls).toEqual([
      { id: BTC.id, period: Period.OneHour, range: { from: 0, to: NOW } },
    ]);

    service.stop();
    await jest.advanceTimersByTimeAsync(10_000);

    expect(source.calls).toEqual([
      { id: BTC.id, period: Period.OneHour, range: { from: 0, to: NOW } },
    ]);
  });
});
