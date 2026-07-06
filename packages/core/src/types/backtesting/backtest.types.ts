import type { Period } from '../config/config.types.js';
import type { RuleEventEntry } from '../rules/rule-event-entry.types.js';
import type { BacktestStrategy } from './backtest-strategy.types.js';

/**
 * The lifecycle status of a {@link Backtest}.
 *
 * A run is created `Running`, is served from the in-memory job while it replays,
 * and transitions to `Completed` once the replay finishes and the result is
 * persisted. There is no persisted `Running` — a cancelled or errored run is
 * discarded entirely, never saved.
 */
export enum BacktestStatus {
  /** The replay is in flight; the backtest is served from the in-memory job. */
  Running = 'running',
  /** The replay finished and the result was persisted under the run's id. */
  Completed = 'completed',
}

/**
 * Why a {@link BacktestTrade} closed.
 *
 * `Signal` — an exit-signal transition sold at the producing candle's close.
 * `ProfitTarget` / `StopLoss` — an intrabar level was hit and filled at the
 * level itself.
 */
export enum BacktestExitReason {
  /** Closed by an exit-signal transition at the candle's close. */
  Signal = 'signal',
  /** Closed because a candle's high reached the profit-target level. */
  ProfitTarget = 'profitTarget',
  /** Closed because a candle's low reached the stop-loss level. */
  StopLoss = 'stopLoss',
}

/**
 * A run's commission model: a `rate` (percent of each fill's notional, stored as
 * a percentage number — `0.1` = 0.1 %) and/or a `fixed` per-fill amount. Both
 * are optional and combinable; a fill's commission is `rate` % of its notional
 * plus `fixed`.
 */
export interface BacktestCommission {
  /** Percent of each fill's notional (`0.1` = 0.1 %). Optional. */
  rate?: number;
  /** Flat amount charged per fill. Optional. */
  fixed?: number;
}

/**
 * The immutable inputs a backtest was run with — the run's parameters.
 *
 * `start` / `end` are epoch milliseconds bounding the half-open replay window
 * `[start, end)`. `profileName` is snapshotted alongside `profileId` so a saved
 * backtest still renders its profile's name after the profile is renamed or
 * removed.
 */
export interface BacktestParams {
  /** The watched symbol the run replayed. */
  symbolId: string;
  /** The profile whose rules drove the run. */
  profileId: string;
  /** The profile's name at run time (snapshotted). */
  profileName: string;
  /** The chart period the run is anchored to for display. */
  period: Period;
  /** Replay window start, epoch milliseconds (inclusive). */
  start: number;
  /** Replay window end, epoch milliseconds (exclusive). */
  end: number;
  /** Starting equity for the run; must be positive. */
  initialCapital: number;
  /** The commission model applied per fill. */
  commission: BacktestCommission;
}

/**
 * One closed round trip: an entry fill and its matching exit fill.
 *
 * `commission` is the total paid across both fills; `pnl` is net of it.
 * `roiPct` divides `pnl` by the entry cost basis (entry notional + entry
 * commission), expressed as a percentage.
 */
export interface BacktestTrade {
  /** Entry fill time, epoch milliseconds. */
  entryTs: number;
  /** Exit fill time, epoch milliseconds. */
  exitTs: number;
  /** Entry fill price. */
  entryPrice: number;
  /** Exit fill price. */
  exitPrice: number;
  /** Position size (fractional). */
  quantity: number;
  /** Total commission paid across both fills. */
  commission: number;
  /** Net profit and loss, after both fills' commissions. */
  pnl: number;
  /** Return on the entry cost basis, as a percentage. */
  roiPct: number;
  /** Why the trade closed. */
  exitReason: BacktestExitReason;
}

/**
 * The position still open when the replay ends — not a trade (no exit fill).
 *
 * `unrealizedPnl` marks it to the last replayed close, without deducting any
 * hypothetical exit commission.
 */
export interface BacktestOpenPosition {
  /** Entry fill time, epoch milliseconds. */
  entryTs: number;
  /** Entry fill price. */
  entryPrice: number;
  /** Position size (fractional). */
  quantity: number;
  /** Commission paid on the entry fill. */
  entryCommission: number;
  /** Mark-to-market P/L at the last replayed close. */
  unrealizedPnl: number;
}

/**
 * Aggregate metrics over a run's **closed trades only** — the open position is
 * reported separately and excluded here.
 *
 * `winners` counts trades with `pnl > 0`, `losers` those with `pnl < 0`; an
 * exact-zero trade counts in `tradeCount` but in neither bucket. The averages
 * are over the closed trades (`0` when there are none).
 */
export interface BacktestSummary {
  /** Σ of every closed trade's `pnl`. */
  totalPnl: number;
  /** `totalPnl / initialCapital × 100`. */
  roiPct: number;
  /** `totalPnl / tradeCount` (`0` with no trades). */
  avgPnlPerTrade: number;
  /** Number of closed trades. */
  tradeCount: number;
  /** Closed trades with `pnl > 0`. */
  winners: number;
  /** Closed trades with `pnl < 0`. */
  losers: number;
  /** Mean of per-trade `roiPct` (`0` with no trades). */
  avgRoiPct: number;
  /** Mean of `(exitTs − entryTs)` in fractional days (`0` with no trades). */
  avgDaysInTrade: number;
}

/**
 * One run and its result — a single resource whose {@link BacktestStatus} moves
 * `Running → Completed`.
 *
 * The run id and the persisted id are the same. A completed backtest embeds a
 * full {@link BacktestStrategy} snapshot (`strategy`) as of run time in addition
 * to `strategyId`, so editing or deleting the source strategy later never
 * changes what the saved run means. Run events are **not** embedded — they live
 * in their own collection keyed by the backtest's id.
 */
export interface Backtest {
  /** The run id and persisted id (identical). */
  id: string;
  /** Auto-generated, renameable display name. */
  name: string;
  /** Lifecycle status. */
  status: BacktestStatus;
  /** Creation time, epoch milliseconds. */
  createdAt: number;
  /** Last-update time, epoch milliseconds. */
  updatedAt: number;
  /** The immutable run inputs. */
  params: BacktestParams;
  /** The source strategy's id (may no longer resolve). */
  strategyId: string;
  /** The full strategy snapshot as of run time. */
  strategy: BacktestStrategy;
  /** Closed round trips, in exit order. */
  trades: BacktestTrade[];
  /** The position still open at `end`, if any. */
  openPosition?: BacktestOpenPosition;
  /** Aggregate metrics over the closed trades. */
  summary: BacktestSummary;
}

/**
 * A running backtest's live progress: how far the replay has advanced through
 * its `[start, end]` window, as elapsed replay days over total days.
 */
export interface BacktestProgress {
  /** Replay days elapsed so far (fractional). */
  elapsedDays: number;
  /** Total days spanned by `[start, end]` (fractional). */
  totalDays: number;
}

/**
 * Driven port for persisting completed {@link Backtest}s, keyed by id.
 *
 * A running backtest is never stored here — only a completed run is saved, under
 * the same id its job used. Implemented by driven adapters (MongoDB); an
 * in-memory adapter backs the unit tier and the shared repository contract.
 */
export interface BacktestRepository {
  /** All persisted (completed) backtests. */
  list(): Promise<Backtest[]>;
  /** One backtest by id, or `null` if none exists. */
  get(id: string): Promise<Backtest | null>;
  /** Upsert a backtest, keyed by id (re-saving an id replaces it). */
  save(backtest: Backtest): Promise<void>;
  /** Delete a backtest by id. Idempotent (no-op when absent). */
  remove(id: string): Promise<void>;
}

/**
 * A windowing query for a backtest's persisted run events — the same
 * `from` / `to` / `limit` shape the live rule-events window uses.
 *
 * `from` is an inclusive lower bound and `to` an exclusive upper bound on each
 * entry's source `ts`; `limit` caps the page size. All are optional.
 */
export interface BacktestEventQuery {
  /** Inclusive lower bound on the entry's source `ts` (epoch ms). */
  from?: number;
  /** Exclusive upper bound on the entry's source `ts` (epoch ms). */
  to?: number;
  /** Max entries to return. */
  limit?: number;
}

/**
 * Driven port for a backtest's run events, stored in their **own** collection
 * keyed by `backtestId` (a chatty profile over a long range would blow Mongo's
 * 16 MB per-document cap if the events were embedded on the backtest).
 *
 * The events are {@link RuleEventEntry}s recorded by the run's isolated engine.
 * They are deleted by cascade when their backtest is removed.
 */
export interface BacktestEventRepository {
  /** Append run events for a backtest, in engine emission order. */
  append(backtestId: string, entries: RuleEventEntry[]): Promise<void>;
  /**
   * Read a backtest's run events newest-first, filtered by the window and
   * capped by `limit`.
   */
  window(backtestId: string, query: BacktestEventQuery): Promise<RuleEventEntry[]>;
  /** Every stored run event for a backtest, in append order (for the contract). */
  list(backtestId: string): Promise<RuleEventEntry[]>;
  /** Delete every run event for a backtest. Idempotent (no-op when absent). */
  removeForBacktest(backtestId: string): Promise<void>;
}
