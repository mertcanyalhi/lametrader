import type { Period } from '@lametrader/core';
import type { BackfillProgress, BackfillSummary } from './backfill.service.types.js';

/**
 * The lifecycle state of a {@link BackfillJob}.
 */
export enum BackfillJobStatus {
  /** The backfill is in progress. */
  Running = 'running',
  /** The backfill finished and persisted its candles. */
  Succeeded = 'succeeded',
  /** The backfill failed; see `error`. */
  Failed = 'failed',
}

/**
 * An asynchronous backfill, tracked as a resource so a transport can return
 * promptly and the caller can poll or stream its progress.
 */
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

/**
 * Notified on every {@link BackfillJob} state change (creation, each progress
 * tick, and the terminal state) so a transport can render it.
 */
export type BackfillJobListener = (job: BackfillJob) => void;
