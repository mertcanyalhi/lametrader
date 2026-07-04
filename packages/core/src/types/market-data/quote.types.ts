import type { Period } from '../config/config.types.js';
import type { WatchedSymbol } from './symbol.types.js';

/**
 * A point-in-time price summary for a symbol, derived from its stored candles on
 * one {@link Period}. `change`/`changePct` are period-over-period ("since the
 * previous close"), the industry-standard last-bar change.
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

/**
 * One live quote frame for a stream subscription: the freshly derived quote at a
 * just-arrived candle. The quote carries only `{ price, change, changePct, time }`
 * (the period is the event's top-level `period`, mirroring how an indicator-state
 * event keeps its period out of the state row).
 */
export interface SymbolQuoteEvent {
  /** The subscription this frame belongs to (server-generated). */
  subscriptionId: string;
  /** Canonical symbol id. */
  id: string;
  /** The period the quote was derived on (the config's `defaultPeriod`). */
  period: Period;
  /** The derived quote values (no `period` — that is the event's top-level field). */
  quote: Omit<SymbolQuote, 'period'>;
  /** Whether the underlying candle is closed (`true`) or still forming (`false`). */
  final: boolean;
}

/**
 * A transport-agnostic sink the quote-streaming use-case emits each
 * {@link SymbolQuoteEvent} to. Driving adapters render it their own way (the API
 * fans it to WebSocket subscribers); the engine knows nothing about delivery (see
 * ADR-0005).
 */
export type SymbolQuoteListener = (event: SymbolQuoteEvent) => void;
