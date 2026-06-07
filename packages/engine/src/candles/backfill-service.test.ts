import {
  CandleError,
  type CryptoCandle,
  Period,
  SymbolNotFoundError,
  SymbolType,
  type WatchedSymbol,
} from '@lametrader/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryMarketDataSource } from '../symbols/in-memory-market-data-source.js';
import { InMemoryWatchlistRepository } from '../symbols/in-memory-watchlist-repository.js';
import { BackfillService } from './backfill-service.js';
import type { BackfillProgress } from './backfill-service.types.js';
import { InMemoryCandleRepository } from './in-memory-candle-repository.js';

/** The watched crypto symbol used across the suite. */
const BTC: WatchedSymbol = {
  id: 'crypto:BTCUSDT',
  type: SymbolType.Crypto,
  description: 'BTC / USDT',
  exchange: 'Binance',
  currency: 'USDT',
  periods: [Period.OneHour],
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

describe('BackfillService', () => {
  let repo: InMemoryCandleRepository;

  beforeEach(() => {
    repo = new InMemoryCandleRepository();
  });

  const serviceWith = (candles: CryptoCandle[], watched: WatchedSymbol[] = [BTC]) =>
    new BackfillService(
      [
        new InMemoryMarketDataSource(
          [BTC],
          [SymbolType.Crypto],
          [{ id: BTC.id, period: Period.OneHour, candles }],
        ),
      ],
      repo,
      new InMemoryWatchlistRepository(watched),
    );

  it('fetches from the owning source and persists every candle, summarizing the window', async () => {
    const service = serviceWith([candle(1000), candle(2000), candle(3000)]);

    const summary = await service.backfill(BTC.id, Period.OneHour, { from: 0, to: 4000 });

    expect(summary).toEqual({
      id: BTC.id,
      period: Period.OneHour,
      from: 1000,
      to: 3000,
      fetched: 3,
      saved: 3,
    });
    expect(await repo.range(BTC.id, Period.OneHour, 0, 4000)).toEqual([
      candle(1000),
      candle(2000),
      candle(3000),
    ]);
  });

  it('with no range fetches the source full history and persists it', async () => {
    const service = serviceWith([candle(1000), candle(2000)]);

    const summary = await service.backfill(BTC.id, Period.OneHour);

    expect(summary).toEqual({
      id: BTC.id,
      period: Period.OneHour,
      from: 1000,
      to: 2000,
      fetched: 2,
      saved: 2,
    });
  });

  it('reports progress per 500-candle chunk', async () => {
    const candles = Array.from({ length: 1200 }, (_, i) => candle((i + 1) * 1000));
    const service = serviceWith(candles);
    const progress: BackfillProgress[] = [];

    await service.backfill(BTC.id, Period.OneHour, undefined, (p) => progress.push(p));

    expect(progress).toEqual([
      { saved: 500, total: 1200 },
      { saved: 1000, total: 1200 },
      { saved: 1200, total: 1200 },
    ]);
  });

  it('throws SymbolNotFoundError and persists nothing when the symbol is not watched', async () => {
    const service = serviceWith([candle(1000)], []);

    await expect(service.backfill(BTC.id, Period.OneHour)).rejects.toBeInstanceOf(
      SymbolNotFoundError,
    );
    expect(await repo.range(BTC.id, Period.OneHour, 0, 4000)).toEqual([]);
  });

  it('throws CandleError and persists nothing when the period is not watched', async () => {
    const service = serviceWith([candle(1000)]);

    await expect(service.backfill(BTC.id, Period.OneDay)).rejects.toBeInstanceOf(CandleError);
    expect(await repo.range(BTC.id, Period.OneDay, 0, 4000)).toEqual([]);
  });

  it('read returns a page with a null cursor when the candles fit within the limit', async () => {
    const service = serviceWith([candle(3000), candle(1000), candle(2000)]);
    await service.backfill(BTC.id, Period.OneHour);

    expect(await service.read(BTC.id, Period.OneHour, { from: 0, to: 4000, limit: 100 })).toEqual({
      candles: [candle(1000), candle(2000), candle(3000)],
      nextCursor: null,
    });
  });

  it('read pages by keyset cursor when more candles remain', async () => {
    const service = serviceWith([candle(1000), candle(2000), candle(3000)]);
    await service.backfill(BTC.id, Period.OneHour);

    const page1 = await service.read(BTC.id, Period.OneHour, { from: 0, to: 4000, limit: 2 });
    expect(page1).toEqual({ candles: [candle(1000), candle(2000)], nextCursor: 3000 });

    const page2 = await service.read(BTC.id, Period.OneHour, {
      from: page1.nextCursor ?? 0,
      to: 4000,
      limit: 2,
    });
    expect(page2).toEqual({ candles: [candle(3000)], nextCursor: null });
  });
});
