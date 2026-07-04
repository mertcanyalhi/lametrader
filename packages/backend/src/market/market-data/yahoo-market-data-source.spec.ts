import { Period, SymbolType } from '@lametrader/core';
import YahooFinance from 'yahoo-finance2';
import { MarketDataError } from '../../domain/symbol.js';
import { resolveYahooChartRange, YahooMarketDataSource } from './yahoo-market-data-source.js';

/** A fixed clock so lookback windows are deterministic. */
const NOW = 1_000_000_000_000;
/** One day in ms. */
const DAY = 86_400_000;

describe('resolveYahooChartRange', () => {
  it('uses a bounded lookback for an intraday interval with no range (not epoch 0)', () => {
    expect(resolveYahooChartRange(Period.OneMinute, undefined, NOW)).toEqual({
      period1: new Date(NOW - 7 * DAY),
      period2: new Date(NOW),
    });
  });

  it('uses epoch 0 (full history) for a daily interval with no range', () => {
    expect(resolveYahooChartRange(Period.OneDay, undefined, NOW)).toEqual({
      period1: new Date(0),
      period2: new Date(NOW),
    });
  });

  it('keeps an intraday range start that already spans several bars', () => {
    expect(
      resolveYahooChartRange(Period.OneMinute, { from: NOW - 10 * 60_000, to: NOW }, NOW),
    ).toEqual({
      period1: new Date(NOW - 10 * 60_000),
      period2: new Date(NOW),
    });
  });

  it('widens a tight intraday range to a few bars so the in-progress bar has real data', () => {
    // A poll resumes from the current bar's open (within one bar of `to`); Yahoo
    // reports that bar with zero volume unless the window spans completed bars.
    expect(resolveYahooChartRange(Period.OneMinute, { from: NOW - 30_000, to: NOW }, NOW)).toEqual({
      period1: new Date(NOW - 3 * 60_000),
      period2: new Date(NOW),
    });
  });

  it('uses the explicit range bounds for a daily interval (no intraday widening)', () => {
    expect(resolveYahooChartRange(Period.OneDay, { from: 100, to: 200 }, NOW)).toEqual({
      period1: new Date(100),
      period2: new Date(200),
    });
  });
});

/** Build an error carrying an HTTP status, as `yahoo-finance2` does on a non-2xx. */
const httpError = (code: number): Error => Object.assign(new Error(`HTTP ${code}`), { code });

describe('YahooMarketDataSource.lookup', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns null when Yahoo rejects the symbol with a 4xx', async () => {
    jest.spyOn(YahooFinance.prototype, 'quote').mockRejectedValue(httpError(404));
    const source = new YahooMarketDataSource();

    expect(await source.lookup('stock:NOPE')).toBeNull();
  });

  it('throws MarketDataError on a 5xx upstream failure', async () => {
    jest.spyOn(YahooFinance.prototype, 'quote').mockRejectedValue(httpError(503));
    const source = new YahooMarketDataSource();

    await expect(source.lookup('stock:AAPL')).rejects.toThrow(MarketDataError);
  });

  it('throws MarketDataError on a network error with no HTTP status', async () => {
    jest.spyOn(YahooFinance.prototype, 'quote').mockRejectedValue(new Error('ECONNRESET'));
    const source = new YahooMarketDataSource();

    await expect(source.lookup('stock:AAPL')).rejects.toThrow(MarketDataError);
  });
});

describe('YahooMarketDataSource.fetchCandles', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('wraps an upstream provider failure in a MarketDataError carrying the cause', async () => {
    jest
      .spyOn(YahooFinance.prototype, 'chart')
      .mockRejectedValue(
        new Error("Data doesn't exist for startDate = 1591957, endDate = 1781260"),
      );
    const source = new YahooMarketDataSource();

    await expect(source.fetchCandles('stock:AAPL', Period.OneHour)).rejects.toThrow(
      MarketDataError,
    );
    await expect(source.fetchCandles('stock:AAPL', Period.OneHour)).rejects.toThrow(
      /Yahoo failed to fetch candles for stock:AAPL: Data doesn't exist/,
    );
  });

  it('merges Yahoo trailing live row into the aligned in-progress bar (running high/low, live close)', async () => {
    const HOUR = 3_600_000;
    // Aligned hourly bars with accumulated data, then Yahoo's trailing live
    // snapshot 55 min into the current hour: a new high (14) and the latest
    // close (13), carrying no volume of its own (V=0), as the real API does.
    jest.spyOn(YahooFinance.prototype, 'chart').mockResolvedValue({
      quotes: [
        {
          date: new Date(3 * HOUR),
          open: 10,
          high: 11,
          low: 9,
          close: 10,
          volume: 100,
          adjclose: 10,
        },
        {
          date: new Date(4 * HOUR),
          open: 11,
          high: 12,
          low: 10,
          close: 11,
          volume: 100,
          adjclose: 11,
        },
        {
          date: new Date(5 * HOUR),
          open: 12,
          high: 13,
          low: 11,
          close: 12,
          volume: 100,
          adjclose: 12,
        },
        {
          date: new Date(5 * HOUR + 55 * 60_000),
          open: 12.5,
          high: 14,
          low: 10,
          close: 13,
          volume: 0,
          adjclose: 13,
        },
      ],
    } as never);
    const source = new YahooMarketDataSource();

    await expect(source.fetchCandles('stock:AAPL', Period.OneHour)).resolves.toEqual({
      candles: [
        {
          type: SymbolType.Stock,
          time: 3 * HOUR,
          open: 10,
          high: 11,
          low: 9,
          close: 10,
          volume: 100,
        },
        {
          type: SymbolType.Stock,
          time: 4 * HOUR,
          open: 11,
          high: 12,
          low: 10,
          close: 11,
          volume: 100,
        },
        {
          type: SymbolType.Stock,
          time: 5 * HOUR,
          open: 12,
          high: 14,
          low: 10,
          close: 13,
          volume: 100,
        },
      ],
      complete: true,
    });
  });

  it('fills a null-OHLC aligned current-period bar from the trailing live row', async () => {
    const MIN = 60_000;
    // Yahoo leaves the aligned current-minute bar all-null until it closes,
    // carrying the live price only on a trailing snapshot 44s in — the exact
    // 1m case that scattered sub-minute rows before the merge.
    jest.spyOn(YahooFinance.prototype, 'chart').mockResolvedValue({
      quotes: [
        {
          date: new Date(3 * MIN),
          open: 10,
          high: 11,
          low: 9,
          close: 10,
          volume: 50,
          adjclose: 10,
        },
        {
          date: new Date(4 * MIN),
          open: 11,
          high: 12,
          low: 10,
          close: 11,
          volume: 50,
          adjclose: 11,
        },
        {
          date: new Date(5 * MIN),
          open: null,
          high: null,
          low: null,
          close: null,
          volume: null,
          adjclose: null,
        },
        {
          date: new Date(5 * MIN + 44_000),
          open: 12.5,
          high: 12.5,
          low: 12.5,
          close: 12.5,
          volume: 0,
          adjclose: 12.5,
        },
      ],
    } as never);
    const source = new YahooMarketDataSource();

    await expect(source.fetchCandles('stock:AAPL', Period.OneMinute)).resolves.toEqual({
      candles: [
        {
          type: SymbolType.Stock,
          time: 3 * MIN,
          open: 10,
          high: 11,
          low: 9,
          close: 10,
          volume: 50,
        },
        {
          type: SymbolType.Stock,
          time: 4 * MIN,
          open: 11,
          high: 12,
          low: 10,
          close: 11,
          volume: 50,
        },
        {
          type: SymbolType.Stock,
          time: 5 * MIN,
          open: 12.5,
          high: 12.5,
          low: 12.5,
          close: 12.5,
          volume: 0,
        },
      ],
      complete: true,
    });
  });

  it('leaves an already-aligned series unchanged (no sub-period trailing row)', async () => {
    const HOUR = 3_600_000;
    jest.spyOn(YahooFinance.prototype, 'chart').mockResolvedValue({
      quotes: [
        {
          date: new Date(3 * HOUR),
          open: 10,
          high: 11,
          low: 9,
          close: 10,
          volume: 100,
          adjclose: 10,
        },
        {
          date: new Date(4 * HOUR),
          open: 11,
          high: 12,
          low: 10,
          close: 11,
          volume: 100,
          adjclose: 11,
        },
        {
          date: new Date(5 * HOUR),
          open: 12,
          high: 13,
          low: 11,
          close: 12,
          volume: 100,
          adjclose: 12,
        },
      ],
    } as never);
    const source = new YahooMarketDataSource();

    await expect(source.fetchCandles('stock:AAPL', Period.OneHour)).resolves.toEqual({
      candles: [
        {
          type: SymbolType.Stock,
          time: 3 * HOUR,
          open: 10,
          high: 11,
          low: 9,
          close: 10,
          volume: 100,
        },
        {
          type: SymbolType.Stock,
          time: 4 * HOUR,
          open: 11,
          high: 12,
          low: 10,
          close: 11,
          volume: 100,
        },
        {
          type: SymbolType.Stock,
          time: 5 * HOUR,
          open: 12,
          high: 13,
          low: 11,
          close: 12,
          volume: 100,
        },
      ],
      complete: true,
    });
  });

  it('drops an equity bar missing volume (no fabricated zero) but keeps a real zero-volume bar', async () => {
    const HOUR = 3_600_000;
    jest.spyOn(YahooFinance.prototype, 'chart').mockResolvedValue({
      quotes: [
        {
          date: new Date(3 * HOUR),
          open: 10,
          high: 11,
          low: 9,
          close: 10,
          volume: 100,
          adjclose: 10,
        },
        // A real no-trade interval: volume is present and 0 — kept.
        {
          date: new Date(4 * HOUR),
          open: 11,
          high: 12,
          low: 10,
          close: 11,
          volume: 0,
          adjclose: 11,
        },
        // Volume absent (Yahoo gap) — incomplete, must not be ingested as 0.
        { date: new Date(5 * HOUR), open: 12, high: 13, low: 11, close: 12, adjclose: 12 },
      ],
    } as never);
    const source = new YahooMarketDataSource();

    await expect(source.fetchCandles('stock:AAPL', Period.OneHour)).resolves.toEqual({
      candles: [
        {
          type: SymbolType.Stock,
          time: 3 * HOUR,
          open: 10,
          high: 11,
          low: 9,
          close: 10,
          volume: 100,
        },
        {
          type: SymbolType.Stock,
          time: 4 * HOUR,
          open: 11,
          high: 12,
          low: 10,
          close: 11,
          volume: 0,
        },
      ],
      complete: true,
    });
  });

  it('returns only bars within the requested range, dropping widened-in lookback bars', async () => {
    const HOUR = 3_600_000;
    // An intraday range is widened back for data quality, so Yahoo also returns
    // older lookback bars — the oldest with bad (zero) volume. Only the requested
    // [from, to) window must be ingested, or those older bars get clobbered.
    jest.spyOn(YahooFinance.prototype, 'chart').mockResolvedValue({
      quotes: [
        {
          date: new Date(2 * HOUR),
          open: 10,
          high: 11,
          low: 9,
          close: 10,
          volume: 0,
          adjclose: 10,
        },
        {
          date: new Date(3 * HOUR),
          open: 11,
          high: 12,
          low: 10,
          close: 11,
          volume: 100,
          adjclose: 11,
        },
        {
          date: new Date(4 * HOUR),
          open: 12,
          high: 13,
          low: 11,
          close: 12,
          volume: 200,
          adjclose: 12,
        },
        {
          date: new Date(5 * HOUR),
          open: 13,
          high: 14,
          low: 12,
          close: 13,
          volume: 300,
          adjclose: 13,
        },
      ],
    } as never);
    const source = new YahooMarketDataSource();

    await expect(
      source.fetchCandles('stock:AAPL', Period.OneHour, { from: 4 * HOUR, to: 6 * HOUR }),
    ).resolves.toEqual({
      candles: [
        {
          type: SymbolType.Stock,
          time: 4 * HOUR,
          open: 12,
          high: 13,
          low: 11,
          close: 12,
          volume: 200,
        },
        {
          type: SymbolType.Stock,
          time: 5 * HOUR,
          open: 13,
          high: 14,
          low: 12,
          close: 13,
          volume: 300,
        },
      ],
      complete: true,
    });
  });

  it('re-stamps a trailing live row that opens a new bucket with no placeholder (the 5m case)', async () => {
    const MIN = 60_000;
    // Equities/FX 5m: Yahoo emits no null placeholder for the current bucket, so
    // the live snapshot (here 11:57, 2 min into the 11:55 bucket) follows the last
    // completed 11:50 bar directly — 7 min on, more than one period.
    jest.spyOn(YahooFinance.prototype, 'chart').mockResolvedValue({
      quotes: [
        {
          date: new Date(45 * MIN),
          open: 10,
          high: 11,
          low: 9,
          close: 10,
          volume: 50,
          adjclose: 10,
        },
        {
          date: new Date(50 * MIN),
          open: 11,
          high: 12,
          low: 10,
          close: 11,
          volume: 50,
          adjclose: 11,
        },
        {
          date: new Date(57 * MIN),
          open: 12.5,
          high: 12.5,
          low: 12.5,
          close: 12.5,
          volume: 0,
          adjclose: 12.5,
        },
      ],
    } as never);
    const source = new YahooMarketDataSource();

    await expect(source.fetchCandles('stock:AAPL', Period.FiveMinutes)).resolves.toEqual({
      candles: [
        {
          type: SymbolType.Stock,
          time: 45 * MIN,
          open: 10,
          high: 11,
          low: 9,
          close: 10,
          volume: 50,
        },
        {
          type: SymbolType.Stock,
          time: 50 * MIN,
          open: 11,
          high: 12,
          low: 10,
          close: 11,
          volume: 50,
        },
        {
          type: SymbolType.Stock,
          time: 55 * MIN,
          open: 12.5,
          high: 12.5,
          low: 12.5,
          close: 12.5,
          volume: 0,
        },
      ],
      complete: true,
    });
  });

  it('snaps the live row using the grid phase of the previous bar, not epoch modulo (session-anchored 1h)', async () => {
    const HALF_HOUR = 1_800_000;
    // Equity 1h bars open at :30 (9:30, 10:30 — not on the epoch hour grid). The
    // live snapshot 45 min into the 10:30 bucket must merge onto 10:30, which plain
    // `time % 1h` would mis-bucket to 11:00.
    jest.spyOn(YahooFinance.prototype, 'chart').mockResolvedValue({
      quotes: [
        {
          date: new Date(19 * HALF_HOUR),
          open: 10,
          high: 11,
          low: 9,
          close: 10,
          volume: 100,
          adjclose: 10,
        },
        {
          date: new Date(21 * HALF_HOUR),
          open: 12,
          high: 13,
          low: 11,
          close: 12,
          volume: 100,
          adjclose: 12,
        },
        {
          date: new Date(21 * HALF_HOUR + 45 * 60_000),
          open: 12.5,
          high: 14,
          low: 10,
          close: 13,
          volume: 0,
          adjclose: 13,
        },
      ],
    } as never);
    const source = new YahooMarketDataSource();

    await expect(source.fetchCandles('stock:AAPL', Period.OneHour)).resolves.toEqual({
      candles: [
        {
          type: SymbolType.Stock,
          time: 19 * HALF_HOUR,
          open: 10,
          high: 11,
          low: 9,
          close: 10,
          volume: 100,
        },
        {
          type: SymbolType.Stock,
          time: 21 * HALF_HOUR,
          open: 12,
          high: 14,
          low: 10,
          close: 13,
          volume: 100,
        },
      ],
      complete: true,
    });
  });

  it('snaps correctly when the previous bar predates a weekend gap (phase is grid-global)', async () => {
    const MIN = 60_000;
    const SPAN = 5 * MIN;
    // The last completed bar is from before the weekend; the live snapshot is 2 min
    // into a bucket ~3 days later. Both sit on the same 5m grid, so their distance is
    // a whole number of periods and the offset (2 min) still snaps to the right bucket.
    const before = 0;
    const bucket = 864 * SPAN;
    jest.spyOn(YahooFinance.prototype, 'chart').mockResolvedValue({
      quotes: [
        { date: new Date(before), open: 10, high: 11, low: 9, close: 10, volume: 50, adjclose: 10 },
        {
          date: new Date(bucket + 2 * MIN),
          open: 12.5,
          high: 12.5,
          low: 12.5,
          close: 12.5,
          volume: 0,
          adjclose: 12.5,
        },
      ],
    } as never);
    const source = new YahooMarketDataSource();

    await expect(source.fetchCandles('stock:AAPL', Period.FiveMinutes)).resolves.toEqual({
      candles: [
        { type: SymbolType.Stock, time: before, open: 10, high: 11, low: 9, close: 10, volume: 50 },
        {
          type: SymbolType.Stock,
          time: bucket,
          open: 12.5,
          high: 12.5,
          low: 12.5,
          close: 12.5,
          volume: 0,
        },
      ],
      complete: true,
    });
  });
});
