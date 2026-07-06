import type { Period } from '../config/config.types.js';
import type { Candle } from '../market-data/candle.types.js';
import type { RuleEventEntry } from '../rules/rule-event-entry.types.js';
import type {
  BacktestOpenPosition,
  BacktestParams,
  BacktestProgress,
  BacktestStatus,
  BacktestSummary,
  BacktestTrade,
} from './backtest.types.js';

/**
 * The kind of a {@link BacktestFrame} pushed over `WS /backtests/:id/stream` —
 * the discriminant of the snapshot-then-deltas protocol.
 *
 * The string value is the serialized tag (stable across JSON round-trips).
 */
export enum BacktestFrameKind {
  /** The one full-state frame sent first on subscribe. */
  Snapshot = 'snapshot',
  /** A batched incremental frame carrying what changed since the last flush. */
  Delta = 'delta',
}

/**
 * One replayed candle tagged with the period it was sampled at — the run-period
 * candles a {@link BacktestDeltaFrame} carries so the client can fill its chart
 * incrementally.
 */
export interface BacktestStreamCandle {
  /** The period the candle was sampled at. */
  period: Period;
  /** The candle itself. */
  candle: Candle;
}

/**
 * The single **snapshot** frame the server sends first when a client subscribes:
 * everything the run has produced so far.
 *
 * Candles are deliberately absent — a reattaching client reads the candle store
 * over REST rather than replaying the whole feed through the socket. `trades`,
 * `summary`, `openPosition`, and `events` reflect the run's state at subscribe
 * time (empty early in a fresh run, fully populated after completion).
 */
export interface BacktestSnapshotFrame {
  /** Discriminant: the snapshot frame. */
  kind: BacktestFrameKind.Snapshot;
  /** The run's lifecycle status at subscribe time. */
  status: BacktestStatus;
  /** Replay progress at subscribe time. */
  progress: BacktestProgress;
  /** The immutable run inputs. */
  params: BacktestParams;
  /** Closed trades produced so far, in exit order. */
  trades: BacktestTrade[];
  /** Running summary over the closed trades so far. */
  summary: BacktestSummary;
  /** The position open at subscribe time, if any. */
  openPosition?: BacktestOpenPosition;
  /** Run events recorded so far, in engine emission order. */
  events: RuleEventEntry[];
}

/**
 * A batched **delta** frame: what changed since the last flush.
 *
 * `candles`, `events`, and `trades` are the **new** items produced since the
 * previous frame (batched — a flush fires every ~100 ms or every N candles),
 * while `progress`, `summary`, and `openPosition` are the run's current values.
 * The final delta of a run carries `status: Completed`; by the time it is sent
 * the backtest is already persisted and fetchable at the same id.
 */
export interface BacktestDeltaFrame {
  /** Discriminant: a delta frame. */
  kind: BacktestFrameKind.Delta;
  /** The run's lifecycle status (`Completed` on the final frame). */
  status: BacktestStatus;
  /** Replay progress after this batch. */
  progress: BacktestProgress;
  /** New run-period candles fed since the last frame. */
  candles: BacktestStreamCandle[];
  /** New run events recorded since the last frame, in emission order. */
  events: RuleEventEntry[];
  /** New closed trades produced since the last frame, in exit order. */
  trades: BacktestTrade[];
  /** The running summary over all closed trades so far. */
  summary: BacktestSummary;
  /** The currently open position, if any. */
  openPosition?: BacktestOpenPosition;
}

/**
 * A frame pushed over `WS /backtests/:id/stream` — the one snapshot sent on
 * subscribe followed by batched deltas until the run completes.
 *
 * Tagged union over {@link BacktestFrameKind}.
 */
export type BacktestFrame = BacktestSnapshotFrame | BacktestDeltaFrame;
