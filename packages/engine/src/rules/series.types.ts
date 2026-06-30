import type { StateValue } from '@lametrader/core';

/**
 * One observation in a series — a timestamp plus the value at that timestamp.
 *
 * `ts` is the candle open time for bar / indicator series, and the tick arrival
 * time for tick series. `value` is wrapped as a {@link StateValue} so every
 * axis (numeric OHLCV, indicator state, ticks) flows through one operator
 * surface.
 */
export interface SeriesPoint {
  /** Epoch milliseconds. */
  ts: number;
  /** The observation at `ts`, wrapped as a {@link StateValue}. */
  value: StateValue;
}

/**
 * Read-only view of a series — the shape every series-aware operator
 * (Crossing, Channel, Moving) walks.
 *
 * Walks happen on the operand's native timeline, newest-first
 * ({@link backwardWalk}); right-hand operands are resampled via {@link asOf}
 * per ADR 0016's series-alignment rule.
 */
export interface SeriesView {
  /** Total number of points in the view. */
  readonly length: number;
  /**
   * Iterate the series newest-first. Each call returns a fresh iterator —
   * safe to consume more than once.
   */
  backwardWalk(): IterableIterator<SeriesPoint>;
  /**
   * The latest point with `ts <= queryTs`, or `null` when none qualify.
   * Used to resample a right-hand operand to a left-hand operand's timestamp.
   */
  asOf(queryTs: number): SeriesPoint | null;
}
