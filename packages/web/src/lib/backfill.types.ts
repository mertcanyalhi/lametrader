import type { Period } from '@lametrader/core';

/**
 * Wire types for the backfill job resource the web app drives over HTTP + the
 * per-job WebSocket. These mirror the API's JSON shape (the backend's domain
 * types live in the server-only `@lametrader/server`, which must not enter the
 * browser bundle), so the web owns its own transport DTOs.
 */

/** Lifecycle state of a backfill job (matches the API's `status` strings). */
export enum BackfillJobStatus {
  /** The backfill is in progress. */
  Running = 'running',
  /** The backfill finished and persisted its candles. */
  Succeeded = 'succeeded',
  /** The backfill failed; see `error`. */
  Failed = 'failed',
}

/** Progress emitted after each persisted chunk. */
export interface BackfillProgress {
  /** Candles persisted so far. */
  saved: number;
  /** Total candles fetched for this backfill. */
  total: number;
}

/** The outcome of a completed backfill. */
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
  /** `false` when the source stopped at a provider cap and more history may exist. */
  complete: boolean;
}

/** A backfill job as returned by the REST endpoints and streamed over the WebSocket. */
export interface BackfillJob {
  /** Opaque job id. */
  id: string;
  /** Canonical symbol id being backfilled. */
  symbolId: string;
  /** Period being backfilled. */
  period: Period;
  /** Lifecycle state. */
  status: BackfillJobStatus;
  /** Latest progress, or `null` before the first persisted chunk. */
  progress: BackfillProgress | null;
  /** The summary once `Succeeded`, else `null`. */
  summary: BackfillSummary | null;
  /** The failure message once `Failed`, else `null`. */
  error: string | null;
}

/** Body for `POST /symbols/:id/backfill`. `from`/`to` are epoch ms; omitting both backfills deepest history. */
export interface StartBackfillInput {
  /** Period to backfill (one job per period). */
  period: Period;
  /** Range start, epoch ms; omitted ⇒ deepest history. */
  from?: number;
  /** Range end, epoch ms. */
  to?: number;
}
