import type { StateValue } from '../state/state.types.js';

/**
 * How a backtest profit-target / stop-loss threshold is expressed.
 *
 * The stored `amount` is interpreted against the entry price per this kind:
 * a `Fixed` amount is an absolute price offset, a `Percentage` amount is a
 * percent of the entry price (stored as a percentage number, `5` = 5 %).
 */
export enum BacktestThresholdKind {
  /** An absolute price offset from the entry price. */
  Fixed = 'fixed',
  /** A percent of the entry price (`5` = 5 %). */
  Percentage = 'percentage',
}

/**
 * An edge-triggered signal: it fires on the candle whose processing makes a
 * symbol-scoped state `key` *become* `value` (`ChangesTo` semantics — a
 * transition, not a level; a repeated set to the same value does not re-fire).
 *
 * The `value.type` doubles as the key's declared value type.
 */
export interface BacktestSignal {
  /** The symbol-scoped state key the signal watches. */
  key: string;
  /** The tagged value the key must change to for the signal to fire. */
  value: StateValue;
}

/**
 * A profit-target or stop-loss threshold: an `amount` interpreted against the
 * entry price per its {@link BacktestThresholdKind}.
 */
export interface BacktestThreshold {
  /** Whether `amount` is an absolute offset or a percentage of entry price. */
  kind: BacktestThresholdKind;
  /** The threshold magnitude (a price offset, or a percentage number). */
  amount: number;
}

/**
 * A strategy's entry definition.
 *
 * v1 requires an entry {@link BacktestSignal}; the field is an object (not a bare
 * signal) so multi-condition entries can be added later without a shape change.
 */
export interface BacktestStrategyEntry {
  /** The transition that opens a position while flat. */
  signal: BacktestSignal;
}

/**
 * A strategy's exit definition — **at least one** mechanism is required.
 *
 * When several are set they all apply; at run time the finest-period candle's
 * intrabar levels are checked (stop-loss before profit-target) before the
 * close-driven exit signal.
 */
export interface BacktestStrategyExit {
  /** A transition that closes the position at the producing candle's close. */
  signal?: BacktestSignal;
  /** A profit-target level, entry-relative per its kind. */
  profitTarget?: BacktestThreshold;
  /** A stop-loss level, entry-relative per its kind. */
  stopLoss?: BacktestThreshold;
}

/**
 * The mutable fields of a {@link BacktestStrategy} — everything except its
 * identity and timestamps.
 *
 * Shared by the create/replace validation helpers.
 */
export interface BacktestStrategyFields {
  /** Human-readable, unique name. */
  name: string;
  /** Free-text description (may be empty). */
  description: string;
  /** The required entry definition. */
  entry: BacktestStrategyEntry;
  /** The exit definition — at least one mechanism set. */
  exit: BacktestStrategyExit;
}

/**
 * A persisted backtest strategy: a named, symbol-agnostic entry/exit definition,
 * plus a generated id and creation/update timestamps.
 *
 * A strategy is reusable across runs; a run embeds a full snapshot of the
 * strategy as of run time, so editing or deleting a strategy later never changes
 * what a saved backtest means.
 */
export interface BacktestStrategy extends BacktestStrategyFields {
  /** Generated, stable id. */
  id: string;
  /** Creation time, epoch milliseconds. */
  createdAt: number;
  /** Last-update time, epoch milliseconds. */
  updatedAt: number;
}

/**
 * Driven port for persisting {@link BacktestStrategy}s, keyed by id.
 *
 * Implemented by driven adapters (MongoDB); an in-memory adapter backs the unit
 * tier and the shared repository contract.
 */
export interface BacktestStrategyRepository {
  /**
   * All stored strategies.
   */
  list(): Promise<BacktestStrategy[]>;
  /**
   * One strategy by id, or `null` if none exists.
   */
  get(id: string): Promise<BacktestStrategy | null>;
  /**
   * Upsert a strategy, keyed by id (re-saving an id replaces it).
   */
  save(strategy: BacktestStrategy): Promise<void>;
  /**
   * Delete a strategy by id. Idempotent (no-op when absent).
   */
  remove(id: string): Promise<void>;
}
