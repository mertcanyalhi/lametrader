import { type CryptoCandle, Period, SymbolType, type WatchedSymbol } from '@lametrader/core';
import {
  BackfillService,
  InMemoryCandleRepository,
  InMemoryMarketDataSource,
  InMemoryWatchlistRepository,
} from '@lametrader/engine';
import { describe, expect, it } from 'vitest';
import { runCandles } from './candles.js';

/** The watched crypto symbol the CLI suite operates on. */
const BTC: WatchedSymbol = {
  id: 'crypto:BTCUSDT',
  type: SymbolType.Crypto,
  description: 'BTC / USDT',
  exchange: 'Binance',
  currency: 'USDT',
  periods: [Period.OneHour],
};

/** Build a crypto candle at `time`. */
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

/** A BackfillService wired entirely from in-memory adapters. */
const makeService = (candles: CryptoCandle[]) =>
  new BackfillService(
    [
      new InMemoryMarketDataSource(
        [BTC],
        [SymbolType.Crypto],
        [{ id: BTC.id, period: Period.OneHour, candles }],
      ),
    ],
    new InMemoryCandleRepository(),
    new InMemoryWatchlistRepository([BTC]),
  );

describe('runCandles', () => {
  it('backfill prints progress lines and returns the summary JSON', async () => {
    const service = makeService([candle(1000), candle(2000)]);
    const lines: string[] = [];

    const out = await runCandles(['backfill', BTC.id, '--period', '1h'], service, (l) =>
      lines.push(l),
    );

    expect(lines).toEqual(['progress: 2/2']);
    expect(JSON.parse(out)).toEqual({
      id: BTC.id,
      period: '1h',
      from: 1000,
      to: 2000,
      fetched: 2,
      saved: 2,
      complete: true,
    });
  });

  it('list prints a page of stored candles as JSON', async () => {
    const service = makeService([candle(1000), candle(2000)]);
    await runCandles(['backfill', BTC.id, '--period', '1h'], service, () => {});

    const out = await runCandles(['list', BTC.id, '--period', '1h'], service, () => {});

    expect(JSON.parse(out)).toEqual({ candles: [candle(1000), candle(2000)], nextCursor: null });
  });

  it('list paginates with --limit, surfacing the next cursor', async () => {
    const service = makeService([candle(1000), candle(2000), candle(3000)]);
    await runCandles(['backfill', BTC.id, '--period', '1h'], service, () => {});

    const out = await runCandles(
      ['list', BTC.id, '--period', '1h', '--limit', '2'],
      service,
      () => {},
    );

    expect(JSON.parse(out)).toEqual({ candles: [candle(1000), candle(2000)], nextCursor: 3000 });
  });
});
