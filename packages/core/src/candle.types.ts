import type { Period } from './config.types.js';
import type { SymbolType } from './symbol.types.js';

/**
 * The OHLC fields shared by every candle, regardless of asset class. `time` is
 * the candle's **open** time as epoch milliseconds (UTC).
 */
export interface BaseCandle {
  /** Candle open time, epoch milliseconds (UTC). */
  time: number;
  /** Open price. */
  open: number;
  /** Highest traded price in the interval. */
  high: number;
  /** Lowest traded price in the interval. */
  low: number;
  /** Close price. */
  close: number;
}

/**
 * A crypto candle: OHLC plus exchange-reported traded volumes and trade count.
 */
export interface CryptoCandle extends BaseCandle {
  /** Discriminant: a crypto candle. */
  type: SymbolType.Crypto;
  /** Base-asset volume traded in the interval. */
  volume: number;
  /** Quote-asset (pricing currency) volume traded in the interval. */
  quoteVolume: number;
  /** Number of individual trades in the interval. */
  trades: number;
}

/**
 * An equity (stock/fund) candle: OHLC plus share volume and a split/dividend
 * adjusted close.
 */
export interface EquityCandle extends BaseCandle {
  /** Discriminant: a listed-equity or fund candle. */
  type: SymbolType.Stock | SymbolType.Fund;
  /** Shares/units traded in the interval. */
  volume: number;
  /** Close adjusted for splits and dividends. */
  adjClose: number;
}

/**
 * A foreign-exchange candle: OHLC only. FX spot has no consolidated volume.
 */
export interface FxCandle extends BaseCandle {
  /** Discriminant: an FX-pair candle. */
  type: SymbolType.Fx;
}

/**
 * A stored OHLC candle, discriminated on {@link BaseCandle} `type`. Each asset
 * class carries exactly the extra fields its market reports.
 */
export type Candle = CryptoCandle | EquityCandle | FxCandle;

/**
 * A half-open `[from, to)` backfill window in epoch milliseconds (`from < to`).
 * Optional at the use-case boundary — omitting it backfills the provider's
 * deepest available history.
 */
export interface BackfillRange {
  /** Inclusive lower bound, epoch milliseconds. */
  from: number;
  /** Exclusive upper bound, epoch milliseconds. */
  to: number;
}

/**
 * The result of fetching candles from a {@link MarketDataSource}: the candles
 * (ascending by `time`) and whether they are the **complete** set the provider
 * holds for the request. `complete` is `false` when the adapter stopped at a
 * provider-side safety cap (e.g. a keyless paging limit) and more history may
 * exist — so a backfill can report that it was truncated rather than appearing
 * to have fetched everything.
 */
export interface CandleBatch {
  /** The fetched candles, ascending by `time`. */
  candles: Candle[];
  /**
   * `true` when these are all the candles the provider holds for the request;
   * `false` when fetching stopped at a provider-side cap (more may exist).
   */
  complete: boolean;
}

/**
 * One page of stored candles: the candles (ascending by `time`) plus the keyset
 * cursor — the `time` to pass as the next page's `from`, or `null` when this is
 * the last page.
 */
export interface CandlePage {
  /** The page's candles, ascending by `time`. */
  candles: Candle[];
  /** The next page's `from` (`time` of the first excluded candle), or `null`. */
  nextCursor: number | null;
  /**
   * The `time` of the latest stored candle for this `(symbol, period)`,
   * regardless of the request window — or `null` when none is stored at all.
   * Lets the chart tell "no history anywhere" from "history outside this window"
   * and re-anchor to it instead of showing the empty state.
   */
  latestTime: number | null;
}

/**
 * Driven port for persisting OHLC candles, keyed by `(symbol, period, time)`.
 * Implemented by driven adapters (MongoDB); an in-memory adapter backs the unit
 * tier.
 */
export interface CandleRepository {
  /**
   * Upsert candles for one symbol+period, keyed by `time` (re-saving a `time`
   * replaces it — never duplicates).
   */
  save(symbolId: string, period: Period, candles: Candle[]): Promise<void>;
  /**
   * Stored candles for the symbol+period within `[from, to)`, ascending by `time`.
   * When `limit` is given, returns at most that many (the lowest-`time` first).
   */
  range(
    symbolId: string,
    period: Period,
    from: number,
    to: number,
    limit?: number,
  ): Promise<Candle[]>;
  /**
   * The highest-`time` stored candle for the symbol+period, or `null` if none.
   */
  latest(symbolId: string, period: Period): Promise<Candle | null>;
  /**
   * The most recent `n` stored candles for the symbol+period, ordered
   * highest-`time` first (newest at index 0), capped at however many exist.
   * Empty when none are stored.
   */
  latestN(symbolId: string, period: Period, n: number): Promise<Candle[]>;
  /**
   * Delete every stored candle for the symbol, across all periods. Idempotent
   * (no-op when none exist). Used when a symbol is removed from the watchlist.
   */
  deleteSymbol(symbolId: string): Promise<void>;
}
