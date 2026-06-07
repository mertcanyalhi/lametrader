import {
  type BackfillRange,
  type Candle,
  CandleError,
  type EquityCandle,
  type FxCandle,
  type Instrument,
  MarketDataError,
  type MarketDataSource,
  Period,
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
      // No price → treat as non-existent (Yahoo also throws for unknown tickers).
      if (!quote || quote.regularMarketPrice == null) return null;
      const instrument = toInstrument(
        native,
        type,
        quote.longName ?? quote.shortName ?? ticker,
        quote.exchange ?? '',
      );
      return quote.currency ? { ...instrument, currency: quote.currency } : instrument;
    } catch {
      return null;
    }
  }

  async fetchCandles(id: string, period: Period, range?: BackfillRange): Promise<Candle[]> {
    const type = symbolType(id);
    if (!this.types.includes(type)) return [];
    const interval = YAHOO_INTERVAL[period];
    if (!interval) {
      throw new CandleError(`Yahoo does not support period ${period}`);
    }
    const ticker = id.slice(`${type}:`.length);
    const native = type === SymbolType.Fx ? `${ticker}=X` : ticker;
    try {
      const chart = await this.yf.chart(native, {
        period1: range ? new Date(range.from) : new Date(0),
        period2: range ? new Date(range.to) : new Date(),
        interval,
      });
      const out: Candle[] = [];
      for (const bar of chart.quotes as YahooBar[]) {
        const candle = toCandle(type, bar);
        if (candle) out.push(candle);
      }
      return out;
    } catch (cause) {
      throw new MarketDataError(
        `Yahoo failed to fetch candles for ${id}: ${(cause as Error).message}`,
        { cause },
      );
    }
  }
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
