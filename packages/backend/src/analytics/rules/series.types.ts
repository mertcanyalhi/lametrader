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
 *
 * The walk is **async** so a view can page its backing store lazily as the
 * consumer advances — the bar-axis view pages the candle repository newest-first
 * and only fetches a page when the walk crosses into it, so an operator that
 * stops after two points touches the store once instead of scanning the whole
 * history (the {@link import('./bar-series-view.js').PagedBarSeriesView} pager).
 * In-memory views (`ArraySeriesView`, the single-point live mirror) satisfy the
 * same contract trivially by yielding their held points.
 *
 * There is deliberately no `length`: a lazy pager has no cheap count, so every
 * consumer walks-and-counts instead (e.g. `Moving` walks up to `lookbackBars + 1`
 * points rather than asking for a length up front).
 */
export interface SeriesView {
  /**
   * Iterate the series newest-first. Each call returns a fresh iterator —
   * safe to consume more than once.
   *
   * Async so a paging view can fetch the next page mid-walk; a consumer that
   * stops early never triggers the fetches for pages it didn't reach.
   */
  backwardWalk(): AsyncIterableIterator<SeriesPoint>;
  /**
   * The latest point with `ts <= queryTs`, or `null` when none qualify.
   * Used to resample a right-hand operand to a left-hand operand's timestamp.
   */
  asOf(queryTs: number): Promise<SeriesPoint | null>;
}
