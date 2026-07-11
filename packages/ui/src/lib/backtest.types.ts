import type { BacktestCommission, Period } from '@lametrader/core';

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
