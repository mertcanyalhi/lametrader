import {
  type Candle,
  type CandleRepository,
  IndicatorError,
  IndicatorNotFoundError,
  Period,
  periodMillis,
  SymbolNotFoundError,
  SymbolType,
  type WatchedSymbol,
} from '@lametrader/core';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryCandleRepository } from '../candles/in-memory-candle-repository.js';
import { InMemoryWatchlistRepository } from '../symbols/in-memory-watchlist-repository.js';
import { defaultIndicators } from './default-indicators.js';
import { defineIndicator } from './define-indicator.js';
import { IndicatorComputeService } from './indicator-compute-service.js';
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

async function build(): Promise<{
  service: IndicatorComputeService;
  watchlist: InMemoryWatchlistRepository;
  candles: InMemoryCandleRepository;
}> {
  const watchlist = new InMemoryWatchlistRepository([BTC, EURUSD]);
  const candles = new InMemoryCandleRepository();
  const service = new IndicatorComputeService(defaultIndicators(), watchlist, candles);
  return { service, watchlist, candles };
}

describe('IndicatorComputeService.compute', () => {
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

    // Compute-from-earliest then slice: row at time=3 is already warm (mean of 20,30,40 = 30).
    expect(result.state).toEqual([
      { time: 3, value: expect.closeTo(30, 6) },
      { time: 4, value: expect.closeTo(40, 6) },
    ]);
  });

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

  it('throws IndicatorError when the symbol type is not in the indicator appliesTo', async () => {
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

  it('loads `[from - warmup*periodMillis, to)` from the candle repo when both `from` and `to` and the module declares warmup', async () => {
    const { service, candles } = await build();
    const spy = vi.spyOn(candles, 'range');
    // `from` chosen large enough that `from - 14*1h` stays positive — the
    // clamp-at-zero case is covered by a separate test below.
    const from = 100 * periodMillis(Period.OneHour);
    const to = from + periodMillis(Period.OneHour);
    await candles.save(BTC.id, Period.OneHour, [candle(from, 100)]);

    await service.compute(BTC.id, 'sma', { length: 14 }, Period.OneHour, { from, to });

    expect(spy.mock.calls).toEqual([
      [BTC.id, Period.OneHour, from - 14 * periodMillis(Period.OneHour), to],
    ]);
  });

  it('loads `[0, MAX_SAFE_INTEGER)` from the candle repo when neither `from` nor `to` is supplied', async () => {
    const { service, candles } = await build();
    const spy = vi.spyOn(candles, 'range');
    await candles.save(BTC.id, Period.OneHour, [candle(0, 100)]);

    await service.compute(BTC.id, 'sma', { length: 14 }, Period.OneHour);

    expect(spy.mock.calls).toEqual([[BTC.id, Period.OneHour, 0, Number.MAX_SAFE_INTEGER]]);
  });

  it('loads exactly `[from, to)` when the module does not declare a `warmup`', async () => {
    const watchlist = new InMemoryWatchlistRepository([BTC]);
    const candles = new InMemoryCandleRepository();
    const registry = new IndicatorRegistry();
    // A module without `warmup` — the service must use 0 as the margin.
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
    const service = new IndicatorComputeService(registry, watchlist, candles);
    const spy = vi.spyOn(candles, 'range');

    await service.compute(BTC.id, 'noop', {}, Period.OneHour, {
      from: 1_000_000,
      to: 2_000_000,
    });

    expect(spy.mock.calls).toEqual([[BTC.id, Period.OneHour, 1_000_000, 2_000_000]]);
  });

  it('clamps a negative warm-up margin at 0 — the load `from` never goes below 0', async () => {
    const { service, candles } = await build();
    const spy = vi.spyOn(candles, 'range');
    await candles.save(BTC.id, Period.OneHour, [candle(0, 100)]);

    await service.compute(BTC.id, 'sma', { length: 14 }, Period.OneHour, {
      from: 0,
      to: 1_000_000,
    });

    expect(spy.mock.calls).toEqual([[BTC.id, Period.OneHour, 0, 1_000_000]]);
  });
});
