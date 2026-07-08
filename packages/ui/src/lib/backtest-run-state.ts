import type {
  BacktestDeltaFrame,
  BacktestSnapshotFrame,
  BacktestStreamCandle,
  Candle,
  Period,
} from '@lametrader/core';
import type { BacktestRunState } from './backtest.types.js';

/**
 * Seed a {@link BacktestRunState} from the stream's one snapshot frame — the
 * first frame a subscriber receives.
 *
 * The snapshot carries the run's full state at subscribe time except candles (a
 * reattaching client reads the candle store over REST rather than replaying the
 * whole feed through the socket), so `candles` starts empty and fills from the
 * delta frames that follow.
 *
 * @param frame - the snapshot frame to seed from.
 */
export function runStateFromSnapshot(frame: BacktestSnapshotFrame): BacktestRunState {
  return {
    status: frame.status,
    progress: frame.progress,
    params: frame.params,
    candles: [],
    trades: frame.trades,
    summary: frame.summary,
    openPosition: frame.openPosition,
    events: frame.events,
  };
}

/**
 * Fold a batched delta frame into the accumulated run state.
 *
 * `candles`, `events`, and `trades` are the **new** items the batch produced, so
 * they append; `status`, `progress`, `summary`, and `openPosition` are the run's
 * current values, so they replace. The result is a fresh object (the inputs are
 * never mutated) so React sees a new reference and re-renders.
 *
 * @param state - the state accumulated before this frame.
 * @param frame - the delta frame to apply.
 */
export function applyBacktestDelta(
  state: BacktestRunState,
  frame: BacktestDeltaFrame,
): BacktestRunState {
  return {
    status: frame.status,
    progress: frame.progress,
    params: state.params,
    candles: [...state.candles, ...frame.candles],
    trades: [...state.trades, ...frame.trades],
    summary: frame.summary,
    openPosition: frame.openPosition,
    events: [...state.events, ...frame.events],
  };
}

/**
 * Project the run's accumulated stream candles onto the one charted `period`,
 * ascending by `time` and deduplicated (a later candle at the same `time`
 * replaces the earlier one, so a re-sent bar updates rather than doubling).
 *
 * @param candles - the run's accumulated {@link BacktestStreamCandle}s.
 * @param period - the period the chart is anchored to.
 */
export function chartCandlesFor(
  candles: readonly BacktestStreamCandle[],
  period: Period,
): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const entry of candles) {
    if (entry.period === period) byTime.set(entry.candle.time, entry.candle);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}
