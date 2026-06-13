import type { BackfillRange, CandleBatch } from './candle.types.js';
import type { Period } from './config.types.js';

/**
 * The asset classes the platform can track. The value is the prefix of a
 * canonical symbol id (`"<type>:<ticker>"`).
 */
export enum SymbolType {
  /** Cryptocurrency pair (e.g. `crypto:BTCUSDT`). */
  Crypto = 'crypto',
  /** Listed equity (e.g. `stock:AAPL`). */
  Stock = 'stock',
  /** Fund / ETF (e.g. `fund:SPY`). */
  Fund = 'fund',
  /** Foreign-exchange pair (e.g. `fx:EURUSD`). */
  Fx = 'fx',
}

/**
 * A discovered instrument. The `id` is canonical (`"<type>:<ticker>"`); the
 * ticker is the source-native symbol with no slashes.
 */
export interface Instrument {
  /** Canonical id, e.g. `"crypto:BTCUSDT"`. */
  id: string;
  /** Asset class (also the id's prefix). */
  type: SymbolType;
  /** Human-readable name, e.g. `"Apple Inc."`. */
  description: string;
  /** Venue/exchange the instrument trades on, e.g. `"Binance"`, `"NMS"`. */
  exchange: string;
  /**
   * Pricing currency, e.g. `"USDT"`, `"USD"`. Optional: present from Binance and
   * from a Yahoo lookup, but absent from Yahoo search results (which omit it).
   */
  currency?: string;
}

/**
 * A symbol persisted on the watchlist, with the per-symbol periods we maintain
 * data for. `periods` is a non-empty subset of the global config's periods.
 */
export interface WatchedSymbol extends Instrument {
  /** Timeframes to backfill/poll for this symbol. */
  periods: Period[];
}

/**
 * Driven port for a market-data provider: discover symbols and confirm one
 * exists. One implementation per provider (Binance, Yahoo, …).
 */
export interface MarketDataSource {
  /** The asset classes this source serves. */
  readonly types: SymbolType[];
  /**
   * The {@link Period}s this source can fetch candles at. A symbol may only be
   * watched at periods its owning source supports (e.g. Yahoo has no 4h bar).
   */
  readonly periods: Period[];
  /**
   * Search the provider for symbols matching a free-text query.
   */
  search(query: string): Promise<Instrument[]>;
  /**
   * Look a canonical id up at the provider; `null` if it does not exist.
   */
  lookup(id: string): Promise<Instrument | null>;
  /**
   * Fetch OHLC candles for a canonical id at a {@link Period}, ascending by
   * `time` and typed for the source's asset class. With `range` omitted, returns
   * the provider's deepest available history. The {@link CandleBatch} reports
   * whether the result is complete or was capped by a provider-side limit.
   */
  fetchCandles(id: string, period: Period, range?: BackfillRange): Promise<CandleBatch>;
}

/**
 * Driven port for persisting the watchlist (a per-id singleton set).
 */
export interface WatchlistRepository {
  /** All watched symbols. */
  list(): Promise<WatchedSymbol[]>;
  /** One watched symbol, or `null` if not watched. */
  get(id: string): Promise<WatchedSymbol | null>;
  /** Add or replace a watched symbol (keyed by id). */
  add(symbol: WatchedSymbol): Promise<void>;
  /** Remove a watched symbol by id (no-op if absent). */
  remove(id: string): Promise<void>;
}
