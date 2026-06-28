/**
 * One sample on a {@link SeriesView}: a numeric value at an epoch-ms timestamp.
 *
 * Series-aware operators (Crossing, Channel, Moving) only consume numeric
 * series, so the sample's `value` is always `number`.
 * Non-numeric operand kinds (state refs, non-numeric indicator state-keys,
 * literals) return `null` from {@link EvaluationContext.resolveSeries}.
 */
export interface SeriesSample {
  /** Epoch-ms timestamp. */
  ts: number;
  /** The numeric value at `ts`. */
  value: number;
}

/**
 * An ordered series view that series-aware operators read from.
 *
 * Samples are ordered ascending by `ts` (newest LAST), so backward walks run
 * from `samples().length - 1` down to `0`.
 * Implementations may back this with an in-memory ring (ticks), a candle-repo
 * window (bars), or an in-memory recomputed array (indicator state-keys).
 */
export interface SeriesView {
  /** Number of samples currently in the view. */
  length(): number;
  /** Read-only access to the samples, ascending by `ts` (newest last). */
  samples(): readonly SeriesSample[];
  /**
   * The most recent sample, or `null` when the view is empty.
   */
  latest(): SeriesSample | null;
  /**
   * The most recent sample whose `ts <= asOfTs` (step-function lookup) — the
   * shape series-alignment uses to resample the right operand of a
   * cross-frequency series-aware operator at the left operand's native
   * timestamps (per ADR 0016 / CONTEXT.md).
   *
   * Returns `null` when no sample exists at or before `asOfTs`.
   */
  asOf(asOfTs: number): SeriesSample | null;
}
