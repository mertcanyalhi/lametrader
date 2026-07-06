import type {
  BacktestCommission,
  BacktestOpenPosition,
  BacktestParams,
  BacktestProgress,
  BacktestStatus,
  BacktestStreamCandle,
  BacktestSummary,
  BacktestTrade,
  Period,
  RuleEventEntry,
} from '@lametrader/core';

/**
 * The `POST /backtests` request body — a run request the web sends to start a
 * backtest.
 *
 * Mirrors the backend's `BacktestRunInputDto` field-for-field: the immutable run
 * inputs plus the source strategy id. `start` / `end` are epoch milliseconds
 * bounding the half-open replay window `[start, end)`; `commission` is the
 * per-fill model (rate percent and/or flat fixed), both optional and combinable.
 */
export interface BacktestRunInput {
  /** The source strategy id (snapshotted at run time by the server). */
  strategyId: string;
  /** The watched symbol to replay. */
  symbolId: string;
  /** The profile whose rules drive the run. */
  profileId: string;
  /** The chart period the run is anchored to. */
  period: Period;
  /** Replay window start, epoch milliseconds (inclusive). */
  start: number;
  /** Replay window end, epoch milliseconds (exclusive). */
  end: number;
  /** Starting equity; must be positive. */
  initialCapital: number;
  /** The per-fill commission model (omit for none). */
  commission: BacktestCommission;
}

/**
 * The web's accumulated view of a live run, folded from the stream's one
 * snapshot frame plus its batched delta frames.
 *
 * `candles` is every run-period {@link BacktestStreamCandle} delivered by delta
 * frames since subscribe (the snapshot carries none — a reattaching client reads
 * the candle store over REST); `trades`, `events`, `summary`, `openPosition`,
 * `progress`, and `status` are the run's current values after the latest frame.
 */
export interface BacktestRunState {
  /** The run's lifecycle status after the latest frame. */
  status: BacktestStatus;
  /** Replay progress after the latest frame. */
  progress: BacktestProgress;
  /** The immutable run inputs (from the snapshot frame). */
  params: BacktestParams;
  /** Run-period candles accumulated from delta frames, in arrival order. */
  candles: BacktestStreamCandle[];
  /** Closed trades produced so far, in exit order. */
  trades: BacktestTrade[];
  /** Running summary over the closed trades so far. */
  summary: BacktestSummary;
  /** The position open after the latest frame, if any. */
  openPosition: BacktestOpenPosition | undefined;
  /** Run events recorded so far, in engine emission order. */
  events: RuleEventEntry[];
}
