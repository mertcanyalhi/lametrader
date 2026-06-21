import type { BaseCandle } from './candle.types.js';
import type { SymbolQuote } from './quote.types.js';

/**
 * Derive the period-agnostic part of a {@link SymbolQuote} from a symbol's two
 * most recent candles: `price` (latest close), `change` (latest − previous
 * close), `changePct` (`change / previousClose`), and `time` (latest open time).
 * Pure: the caller supplies the {@link SymbolQuote.period} the candles came from.
 *
 * @param latest - the most recent candle.
 * @param previous - the candle immediately before it.
 */
export function computeQuote(
  latest: BaseCandle,
  previous: BaseCandle,
): Omit<SymbolQuote, 'period'> {
  const change = latest.close - previous.close;
  return {
    price: latest.close,
    change,
    // A 0 prior close has no defined percentage change (would be Infinity/NaN,
    // which fast-json-stringify emits as contract-violating `null`) — report flat.
    changePct: previous.close === 0 ? 0 : change / previous.close,
    time: latest.time,
  };
}
