import {
  type Candle,
  IndicatorError,
  IndicatorNotFoundError,
  Period,
  SymbolNotFoundError,
  SymbolType,
  type WatchedSymbol,
} from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { InMemoryCandleRepository } from '../candles/in-memory-candle-repository.js';
import { InMemoryWatchlistRepository } from '../symbols/in-memory-watchlist-repository.js';
import { defaultIndicators } from './default-indicators.js';
import { IndicatorComputeService } from './indicator-compute-service.js';

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
});
