import {
  type BackfillRange,
  type Candle,
  type CandleBatch,
  CandleError,
  type EquityCandle,
  type FxCandle,
  type Instrument,
  MarketDataError,
  type MarketDataSource,
  Period,
  periodMillis,
  SymbolType,
  symbolType,
} from '@lametrader/core';
import YahooFinance from 'yahoo-finance2';

/**
 * Map Yahoo's `quoteType` to our {@link SymbolType} (others are skipped).
 */
const TYPE_BY_QUOTE: Record<string, SymbolType> = {
  EQUITY: SymbolType.Stock,
  ETF: SymbolType.Fund,
  MUTUALFUND: SymbolType.Fund,
  CURRENCY: SymbolType.Fx,
};

/**
 * Map our {@link Period} to a Yahoo chart `interval`. Yahoo offers no 4h bar.
 */
const YAHOO_INTERVAL: Partial<Record<Period, '1m' | '5m' | '15m' | '30m' | '1h' | '1d' | '1wk'>> = {
  [Period.OneMinute]: '1m',
  [Period.FiveMinutes]: '5m',
  [Period.FifteenMinutes]: '15m',
  [Period.ThirtyMinutes]: '30m',
  [Period.OneHour]: '1h',
  [Period.OneDay]: '1d',
  [Period.OneWeek]: '1wk',
};

/** One day in milliseconds. */
const DAY_MS = 86_400_000;

/**
 * Maximum lookback Yahoo allows for an **intraday** interval with no explicit
 * range. `new Date(0)` is rejected for these (only daily/weekly accept full
 * history), so a no-range intraday fetch must start `now - this`.
 */
const YAHOO_MAX_LOOKBACK_MS: Partial<Record<Period, number>> = {
  [Period.OneMinute]: 7 * DAY_MS,
  [Period.FiveMinutes]: 60 * DAY_MS,
  [Period.FifteenMinutes]: 60 * DAY_MS,
  [Period.ThirtyMinutes]: 60 * DAY_MS,
  [Period.OneHour]: 730 * DAY_MS,
};

/**
 * Resolve the `period1`/`period2` dates for a Yahoo chart request. With an
 * explicit `range`, uses its bounds. With no range, intraday intervals start a
 * bounded lookback before `now` (Yahoo rejects `new Date(0)` for them); daily and
 * weekly start at epoch 0 for the provider's deepest history.
 *
 * @param period - the period being fetched.
 * @param range - the explicit `[from, to)` window, or `undefined` for max history.
 * @param now - current epoch ms (injectable for tests; defaults to `Date.now`).
 */
export function resolveYahooChartRange(
  period: Period,
  range: BackfillRange | undefined,
  now: number = Date.now(),
): { period1: Date; period2: Date } {
  if (range) {
    return { period1: new Date(range.from), period2: new Date(range.to) };
  }
  const lookback = YAHOO_MAX_LOOKBACK_MS[period];
  return {
    period1: lookback ? new Date(now - lookback) : new Date(0),
    period2: new Date(now),
  };
}

/**
 * {@link MarketDataSource} for stocks, funds, and FX, backed by Yahoo Finance
 * (via the unofficial `yahoo-finance2`). FX ids map to Yahoo's `=X` tickers.
 */
export class YahooMarketDataSource implements MarketDataSource {
  /**
   * Yahoo serves stocks, funds/ETFs, and FX here.
   */
  readonly types = [SymbolType.Stock, SymbolType.Fund, SymbolType.Fx];

  /**
   * The periods Yahoo can fetch — the keys of {@link YAHOO_INTERVAL} (no 4h bar).
   */
  readonly periods = Object.keys(YAHOO_INTERVAL) as Period[];

  /**
   * The `yahoo-finance2` client (v3 default export is a class).
   */
  private readonly yf = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

  async search(query: string): Promise<Instrument[]> {
    const res = await this.yf.search(query);
    const out: Instrument[] = [];
    for (const quote of res.quotes as Array<{
      symbol?: string;
      quoteType?: string;
      shortname?: string;
      longname?: string;
      exchange?: string;
    }>) {
      const type = quote.quoteType ? TYPE_BY_QUOTE[quote.quoteType] : undefined;
      if (!quote.symbol || !type) continue;
      // Search results carry the exchange but not the currency.
      out.push(
        toInstrument(
          quote.symbol,
          type,
          quote.shortname ?? quote.longname ?? quote.symbol,
          quote.exchange ?? '',
        ),
      );
    }
    return out;
  }

  async lookup(id: string): Promise<Instrument | null> {
    const type = symbolType(id);
    if (!this.types.includes(type)) return null;
    const ticker = id.slice(`${type}:`.length);
    const native = type === SymbolType.Fx ? `${ticker}=X` : ticker;
    try {
      const quote = (await this.yf.quote(native)) as
        | {
            shortName?: string;
            longName?: string;
            regularMarketPrice?: number;
            exchange?: string;
            currency?: string;
          }
        | undefined;
      // No price → Yahoo's shell-quote signal for an unknown symbol.
      if (!quote || quote.regularMarketPrice == null) return null;
      const instrument = toInstrument(
        native,
        type,
        quote.longName ?? quote.shortName ?? ticker,
        quote.exchange ?? '',
      );
      return quote.currency ? { ...instrument, currency: quote.currency } : instrument;
    } catch (cause) {
      // A 4xx means Yahoo rejected the symbol (genuinely not found); a 5xx,
      // rate-limit, or status-less error (network/timeout) is transient and must
      // not be reported as "no such symbol".
      if (isNotFound(cause)) return null;
      throw new MarketDataError(`Yahoo failed to look up ${id}: ${(cause as Error).message}`, {
        cause,
      });
    }
  }

  async fetchCandles(id: string, period: Period, range?: BackfillRange): Promise<CandleBatch> {
    const type = symbolType(id);
    if (!this.types.includes(type)) return { candles: [], complete: true };
    const interval = YAHOO_INTERVAL[period];
    if (!interval) {
      throw new CandleError(`Yahoo does not support period ${period}`);
    }
    const ticker = id.slice(`${type}:`.length);
    const native = type === SymbolType.Fx ? `${ticker}=X` : ticker;
    try {
      const { period1, period2 } = resolveYahooChartRange(period, range);
      const chart = await this.yf.chart(native, { period1, period2, interval });
      // Fold Yahoo's trailing live row onto its aligned bar *before* mapping, so
      // the null-OHLC current-period bar (the merge anchor) is still present.
      const bars = mergeLiveBar(chart.quotes as YahooBar[], period);
      const out: Candle[] = [];
      for (const bar of bars) {
        const candle = toCandle(type, bar);
        if (candle) out.push(candle);
      }
      // Yahoo's chart returns the whole requested window in one response — no
      // paging cap of ours applies, so the batch is always complete.
      return { candles: out, complete: true };
    } catch (cause) {
      throw new MarketDataError(
        `Yahoo failed to fetch candles for ${id}: ${(cause as Error).message}`,
        { cause },
      );
    }
  }
}

/**
 * Whether a thrown `yahoo-finance2` error means "Yahoo rejected this symbol"
 * (a 4xx client status) rather than a transient failure. `yahoo-finance2`'s
 * `HTTPError` carries `code = response.status`; a 5xx, a rate-limit, or an error
 * with no numeric HTTP status (network/timeout) is treated as transient.
 */
function isNotFound(error: unknown): boolean {
  const code = (error as { code?: unknown }).code;
  return typeof code === 'number' && code >= 400 && code < 500;
}

/**
 * The subset of a Yahoo chart bar we consume. Fields may be `null` for gaps.
 */
interface YahooBar {
  date: Date;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  adjclose?: number | null;
  volume?: number | null;
}

/**
 * Snap Yahoo's trailing live row onto the period grid. Yahoo's v8 chart appends
 * the in-progress interval stamped at the live update time (≈ `now`) as a
 * *separate* quote from that interval's grid-aligned bar — sometimes alongside a
 * null-OHLC placeholder for the current bucket (crypto), sometimes with no
 * placeholder at all (equities/FX), so the live row simply follows the last
 * completed bar. Persisting that row verbatim (the candle key includes `time`)
 * scatters a fresh sub-period row on every poll and drifts the resume cursor off
 * the grid, so the bar's final data is never re-fetched (missing bars) and the
 * period fills with duplicates (e.g. an hourly chart showing 08:07, 08:22, …).
 *
 * Generalises yahoo-finance's `fix_Yahoo_returning_live_separate`: take the grid
 * *phase* from the previous quote (Yahoo's bars are spaced exactly one period
 * apart within a session) and find the live row's bucket open as
 * `live - ((live - prev) % period)`. A zero remainder means the trailing quote is
 * itself grid-aligned (a genuine bar) — leave the series untouched. Otherwise the
 * live row belongs to that bucket: if the previous quote *is* that bucket (with or
 * without OHLC), merge onto it — open from the live row when the bucket is still
 * null, running high/low, the live close, summed volume (the live row carries none
 * of its own); if the bucket has no quote yet, re-stamp the live row to the bucket
 * open. Either way the result is grid-aligned. Phasing off Yahoo's own previous bar
 * (not epoch modulo) keeps session/DST-anchored bars correct — e.g. an equity 1h
 * bar opening at `:30`. The fix covers both backfill and polling (both go through
 * `fetchCandles`); Binance is unaffected (kline `openTime` is already aligned).
 *
 * Daily/weekly keep the simpler same-interval merge: those bars carry no separate
 * live row of concern here and their session/DST stamping is out of scope.
 */
function mergeLiveBar(bars: YahooBar[], period: Period): YahooBar[] {
  if (bars.length < 2) return bars;
  const live = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  if (!live || !prev) return bars;
  const span = periodMillis(period);
  const delta = live.date.getTime() - prev.date.getTime();
  if (delta <= 0) return bars;
  if (span >= DAY_MS) {
    // Daily/weekly: merge only when the trailing quote falls in the same interval.
    return delta < span
      ? [...bars.slice(0, -2), placeLiveBar(prev, live, prev.date.getTime())]
      : bars;
  }
  const offset = delta % span;
  // A grid-aligned trailing quote (no remainder) is a genuine bar — leave it.
  if (offset === 0) return bars;
  const bucketTime = live.date.getTime() - offset;
  if (bucketTime === prev.date.getTime()) {
    // The previous quote is this bucket (placeholder or in-progress) — merge onto it.
    return [...bars.slice(0, -2), placeLiveBar(prev, live, bucketTime)];
  }
  // The bucket has no quote yet (Yahoo omitted the placeholder) — re-stamp the live row.
  return [...bars.slice(0, -1), placeLiveBar(undefined, live, bucketTime)];
}

/**
 * Build the grid-aligned bar at `bucketTime` from a trailing live row, merged onto
 * an existing bucket quote when present (open from the live row if the bucket is
 * still null, running high/low, live close, summed volume — the live row carries
 * none of its own). With no existing quote the live row is simply re-stamped to the
 * bucket open.
 */
function placeLiveBar(
  existing: YahooBar | undefined,
  live: YahooBar,
  bucketTime: number,
): YahooBar {
  if (!existing) {
    return { ...live, date: new Date(bucketTime) };
  }
  return {
    date: new Date(bucketTime),
    open: existing.open ?? live.open,
    high: nanMax(existing.high, live.high),
    low: nanMin(existing.low, live.low),
    close: live.close ?? existing.close,
    adjclose: live.adjclose ?? existing.adjclose,
    volume: (existing.volume ?? 0) + (live.volume ?? 0),
  };
}

/**
 * Larger of two possibly-null bar values, ignoring nulls (NaN-safe max). `null`
 * only when both inputs are null.
 */
function nanMax(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null) return b ?? null;
  if (b == null) return a;
  return Math.max(a, b);
}

/**
 * Smaller of two possibly-null bar values, ignoring nulls (NaN-safe min). `null`
 * only when both inputs are null.
 */
function nanMin(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null) return b ?? null;
  if (b == null) return a;
  return Math.min(a, b);
}

/**
 * Map a Yahoo chart bar to a typed {@link Candle}, or `null` when the bar has no
 * OHLC (a gap). FX yields an {@link FxCandle} (no volume); stocks/funds an
 * {@link EquityCandle}.
 */
function toCandle(type: SymbolType, bar: YahooBar): Candle | null {
  if (bar.open == null || bar.high == null || bar.low == null || bar.close == null) {
    return null;
  }
  const base = {
    time: bar.date.getTime(),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
  };
  if (type === SymbolType.Fx) {
    return { ...base, type: SymbolType.Fx } satisfies FxCandle;
  }
  return {
    ...base,
    type: type === SymbolType.Fund ? SymbolType.Fund : SymbolType.Stock,
    volume: bar.volume ?? 0,
    adjClose: bar.adjclose ?? bar.close,
  } satisfies EquityCandle;
}

/**
 * Build a domain {@link Instrument} from a Yahoo native symbol (stripping the FX
 * `=X` suffix for the canonical id).
 */
function toInstrument(
  nativeSymbol: string,
  type: SymbolType,
  description: string,
  exchange: string,
): Instrument {
  const ticker = type === SymbolType.Fx ? nativeSymbol.replace('=X', '') : nativeSymbol;
  return { id: `${type}:${ticker}`, type, description, exchange };
}
