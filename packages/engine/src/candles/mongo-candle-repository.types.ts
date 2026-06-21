/**
 * Compound primary key for a stored candle: symbol id, period, and open time.
 * Using it as the Mongo `_id` makes `(symbol, period, time)` unique and upserts
 * natural.
 */
export interface CandleId {
  /** Canonical symbol id. */
  s: string;
  /** Period value (`Period` enum string). */
  p: string;
  /** Candle open time, epoch milliseconds. */
  t: number;
}

/**
 * A stored candle document: the OHLC base plus the optional per-asset-class
 * fields, keyed by a compound {@link CandleId}. `type` discriminates which
 * optional fields are present.
 */
export interface CandleDocument {
  /** Compound key `(symbol, period, time)`. */
  _id: CandleId;
  /** Asset-class discriminant (`SymbolType` string). */
  type: string;
  /** Open price. */
  open: number;
  /** High price. */
  high: number;
  /** Low price. */
  low: number;
  /** Close price. */
  close: number;
  /** Traded volume (crypto/equity only). */
  volume?: number;
  /** Quote-asset volume (crypto only). */
  quoteVolume?: number;
  /** Trade count (crypto only). */
  trades?: number;
}
