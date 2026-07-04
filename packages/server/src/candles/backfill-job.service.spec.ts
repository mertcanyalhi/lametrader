import {
  BackfillConflictError,
  type CryptoCandle,
  Period,
  SymbolNotFoundError,
  SymbolType,
  type WatchedSymbol,
} from '@lametrader/core';
import { InMemoryMarketDataSource } from '../market-data/in-memory-market-data-source.js';
import { InMemoryWatchlistRepository } from '../watchlist/in-memory-watchlist.repository.js';
import { BackfillService } from './backfill.service.js';
import { BackfillJobService } from './backfill-job.service.js';
import type { BackfillJob } from './backfill-job.types.js';
import { BackfillJobStatus } from './backfill-job.types.js';
import { InMemoryCandleRepository } from './in-memory-candle.repository.js';

/** The watched crypto symbol used across the suite. */
const BTC: WatchedSymbol = {
  id: 'crypto:BTCUSDT',
  type: SymbolType.Crypto,
  description: 'BTC / USDT',
  exchange: 'Binance',
  currency: 'USDT',
  periods: [Period.OneHour, Period.OneDay],
};

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

/** Settle the microtask queue so the background backfill completes. */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('BackfillJobService', () => {
  let repo: InMemoryCandleRepository;
  let ids: number;

  beforeEach(() => {
    repo = new InMemoryCandleRepository();
    ids = 0;
  });

  const serviceWith = (
    candles: CryptoCandle[],
    onUpdate?: (job: BackfillJob) => void,
  ): BackfillJobService => {
    const backfill = new BackfillService(
      [
        new InMemoryMarketDataSource(
          [BTC],
          [SymbolType.Crypto],
          [
            { id: BTC.id, period: Period.OneHour, candles },
            { id: BTC.id, period: Period.OneDay, candles },
          ],
        ),
      ],
      repo,
      new InMemoryWatchlistRepository([BTC]),
    );
    return new BackfillJobService(backfill, onUpdate, () => {
      ids += 1;
      return `job-${ids}`;
    });
  };

  it('start returns a running job, which settles to succeeded with the summary', async () => {
    const service = serviceWith([candle(1000), candle(2000)]);

    const started = await service.start(BTC.id, Period.OneHour);
    expect(started).toEqual({
      id: 'job-1',
      symbolId: BTC.id,
      period: Period.OneHour,
      status: BackfillJobStatus.Running,
      progress: null,
      summary: null,
      error: null,
    });

    await flush();
    expect(service.get('job-1')).toEqual({
      id: 'job-1',
      symbolId: BTC.id,
      period: Period.OneHour,
      status: BackfillJobStatus.Succeeded,
      progress: { saved: 2, total: 2 },
      summary: {
        id: BTC.id,
        period: Period.OneHour,
        from: 1000,
        to: 2000,
        fetched: 2,
        saved: 2,
        complete: true,
      },
      error: null,
    });
  });

  it('notifies onUpdate for the running job, each progress tick, and the terminal state', async () => {
    const updates: BackfillJob[] = [];
    const service = serviceWith([candle(1000), candle(2000)], (job) => updates.push(job));

    await service.start(BTC.id, Period.OneHour);
    await flush();

    expect(updates.map((job) => job.status)).toEqual([
      BackfillJobStatus.Running, // created
      BackfillJobStatus.Running, // progress tick
      BackfillJobStatus.Succeeded, // terminal
    ]);
    expect(updates[1]?.progress).toEqual({ saved: 2, total: 2 });
  });

  it('rejects a not-watched symbol synchronously, before creating a job', async () => {
    const service = serviceWith([candle(1000)]);

    await expect(service.start('crypto:ETHUSDT', Period.OneHour)).rejects.toBeInstanceOf(
      SymbolNotFoundError,
    );
    expect(service.list()).toEqual([]);
  });

  it('rejects a second concurrent backfill of the same symbol+period with a conflict', async () => {
    const service = serviceWith([candle(1000), candle(2000)]);

    await service.start(BTC.id, Period.OneHour);
    await expect(service.start(BTC.id, Period.OneHour)).rejects.toBeInstanceOf(
      BackfillConflictError,
    );
  });

  it('allows concurrent backfills of the same symbol at different periods', async () => {
    const service = serviceWith([candle(1000), candle(2000)]);

    const a = await service.start(BTC.id, Period.OneHour);
    const b = await service.start(BTC.id, Period.OneDay);

    expect([a.status, b.status]).toEqual([BackfillJobStatus.Running, BackfillJobStatus.Running]);
    expect(service.list().map((job) => job.id)).toEqual(['job-1', 'job-2']);
  });

  it('marks the job failed with the error message when the backfill throws', async () => {
    const service = serviceWith([candle(1000)]);
    // Force the underlying fetch to throw mid-run.
    const backfill = (service as unknown as { backfill: BackfillService }).backfill;
    jest.spyOn(backfill, 'backfill').mockRejectedValue(new Error('boom'));

    await service.start(BTC.id, Period.OneHour);
    await flush();

    const job = service.get('job-1');
    expect(job?.status).toBe(BackfillJobStatus.Failed);
    expect(job?.error).toBe('boom');
  });
});
