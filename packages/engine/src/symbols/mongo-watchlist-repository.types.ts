/**
 * Shape of a persisted watchlist document in the `watchlist` collection. The
 * canonical symbol id is the `_id`.
 */
export interface WatchlistDocument {
  /** Canonical symbol id (e.g. `"crypto:BTCUSDT"`). */
  _id: string;
  /** Symbol type string (a {@link SymbolType} value). */
  type: string;
  /** Human-readable description. */
  description: string;
  /** Venue/exchange. */
  exchange: string;
  /** Pricing currency (optional, source-dependent). */
  currency?: string;
  /** Stored period strings (each a {@link Period} value). */
  periods: string[];
}
