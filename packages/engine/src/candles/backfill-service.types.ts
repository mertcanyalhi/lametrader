import type { Period } from '@lametrader/core';

/**
 * Progress emitted while a backfill persists candles, after each saved chunk.
 */
export interface BackfillProgress {
  /** Candles persisted so far. */
  saved: number;
  /** Total candles fetched for this backfill. */
  total: number;
}

/**
 * A callback notified after each persisted chunk during a backfill.
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
}
