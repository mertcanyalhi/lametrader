import type { BackfillPhase, Period } from '@lametrader/core';

/**
 * Progress emitted during a backfill: one stream of frames across both phases —
 * retrieval ({@link BackfillPhase.Fetching}, `total` estimated) then persistence
 * ({@link BackfillPhase.Saving}, `total` = the actual fetched count).
 */
export interface BackfillProgress {
  /** Which phase this frame describes. */
  phase: BackfillPhase;
  /** Candles retrieved (Fetching) or persisted (Saving) so far. */
  done: number;
  /** Estimated total (Fetching) or actual fetched count (Saving). */
  total: number;
}

/**
 * A callback notified on each progress frame during a backfill.
 */
export type BackfillProgressListener = (progress: BackfillProgress) => void;

/**
 * The outcome of a completed backfill.
 */
export interface BackfillSummary {
  /** Canonical symbol id backfilled. */
  id: string;
  /** Period backfilled. */
  period: Period;
  /** First persisted candle `time` (epoch ms), or `null` when none. */
  from: number | null;
  /** Last persisted candle `time` (epoch ms), or `null` when none. */
  to: number | null;
  /** Number of candles fetched from the source. */
  fetched: number;
  /** Number of candles persisted. */
  saved: number;
  /**
   * `false` when the source stopped at a provider-side cap and more history may
   * exist (the backfill was truncated, not a full fetch); `true` otherwise.
   */
  complete: boolean;
}
