import type { Period } from './config.types.js';
import type { WatchedSymbol } from './symbol.types.js';

/**
 * A point-in-time price summary for a symbol, derived from its stored candles on
 * one {@link Period}. `change`/`changePct` are period-over-period ("since the
 * previous close"), the TV/industry-standard last-bar change.
 */
export interface SymbolQuote {
  /** Latest candle's close. */
  price: number;
  /** Absolute change vs the previous close (`latestClose − previousClose`). */
  change: number;
  /** Change as a rate of the previous close (`change / previousClose`, e.g. `0.0123` for +1.23%). */
  changePct: number;
  /** The period the values were computed on. */
  period: Period;
  /** The latest candle's open time, epoch milliseconds (UTC). */
  time: number;
}

/**
 * A watched symbol with its current {@link SymbolQuote}, or `null` when no quote
 * can be computed (the symbol does not watch the default period, or has fewer
 * than two candles stored there).
 */
export interface EnrichedSymbol extends WatchedSymbol {
  /** The symbol's quote, or `null` when one cannot be computed. */
  quote: SymbolQuote | null;
}
