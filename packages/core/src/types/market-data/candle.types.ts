import type { Period } from '../config/config.types.js';
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
 * An equity (stock/fund) candle: OHLC plus share volume.
 */
export interface EquityCandle extends BaseCandle {
  /** Discriminant: a listed-equity or fund candle. */
  type: SymbolType.Stock | SymbolType.Fund;
  /** Shares/units traded in the interval. */
  volume: number;
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
 * Which half of a backfill a progress frame describes: retrieving candles from
 * the provider ({@link BackfillPhase.Fetching}, the slow paged walk) or
 * persisting them ({@link BackfillPhase.Saving}).
 */
export enum BackfillPhase {
  /** Candles are being retrieved from the provider. */
  Fetching = 'fetching',
  /** Retrieved candles are being persisted. */
  Saving = 'saving',
}

/**
 * Fire-and-forget progress callback for {@link CandleFeed.fetchCandles}, invoked
 * after each retrieved page (or once for a single-response source).
 *
 * @param done - candles retrieved so far.
 * @param total - estimated total to retrieve (see the backfill-fetch-progress spec).
 */
export type CandleFetchProgress = (done: number, total: number) => void;

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
   *
   * When `before` is given, only candles with `time < before` are considered —
   * the warm-up window strictly preceding a request's `from`. This counts back
   * by candle, not calendar span, so series with gaps (weekends, holidays) warm
   * up the same as gapless ones.
   */
  latestN(symbolId: string, period: Period, n: number, before?: number): Promise<Candle[]>;
  /**
   * How many candles are stored for the symbol+period.
   *
   * When `before` is given, only candles with `time < before` are counted (the
   * same exclusive-bound semantics as {@link latestN}). Backed by an index count
   * on the store, so a caller can size a load — e.g. cap a backtest preload —
   * without materializing the candles it is about to count.
   */
  count(symbolId: string, period: Period, before?: number): Promise<number>;
  /**
   * Delete every stored candle for the symbol, across all periods. Idempotent
   * (no-op when none exist). Used when a symbol is removed from the watchlist.
   */
  deleteSymbol(symbolId: string): Promise<void>;
}

/**
 * A new (or updated) candle observed while polling a watched symbol+period,
 * emitted once per fetched candle on each poll.
 *
 * The cross-context streaming contract carried by the live `/stream` candle hub:
 * the market poll loop produces it, the stream gateway fans it to subscribers.
 * It sits in `core` alongside its sibling stream events ({@link SymbolQuoteEvent},
 * `IndicatorStateEvent`, `RuleEventEntry`) so neither producer nor consumer nor
 * the shared hub owns it.
 */
export interface CandleEvent {
  /** Canonical symbol id the candle belongs to. */
  id: string;
  /** The period the candle is sampled at. */
  period: Period;
  /** The candle itself, typed for its asset class. */
  candle: Candle;
  /**
   * Whether the bar has closed (`candle.time + periodMillis(period) <= now`).
   * `false` marks the still-forming bar, which later polls re-emit as it updates.
   */
  final: boolean;
}

/**
 * A transport-agnostic sink the application emits each {@link CandleEvent} to.
 * Driving adapters render it their own way (the live `/stream` WebSocket fans it
 * to subscribers); the application knows nothing about delivery (see ADR-0005).
 */
export type CandleListener = (event: CandleEvent) => void;
