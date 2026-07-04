import { randomUUID } from 'node:crypto';
import { type BackfillRange, type Period } from '@lametrader/core';
import { BackfillConflictError } from '../../domain/candle.js';
import type { BackfillService } from './backfill.service.js';
import type { BackfillJob, BackfillJobListener } from './backfill-job.types.js';
import { BackfillJobStatus } from './backfill-job.types.js';

/**
 * Application use-case for running backfills **asynchronously** as job resources.
 *
 * Wraps the synchronous {@link BackfillService}: `start` validates, registers a
 * `Running` job, kicks off the backfill in the background, and returns the job
 * immediately. The job's progress and terminal state are updated as the work runs
 * and pushed to an optional `onUpdate` listener (which a transport renders — the
 * service stays transport-agnostic, per ADR-0005/ADR-0008). The registry is
 * in-process and non-durable (see ADR-0008).
 *
 * Relocated verbatim from the engine; the {@link import('./candles.module.js').CandlesModule}
 * wires the `onUpdate` listener to publish each job snapshot to the per-job
 * progress stream.
 */
export class BackfillJobService {
  /**
   * Jobs keyed by job id.
   */
  private readonly jobs = new Map<string, BackfillJob>();

  /**
   * @param backfill - the synchronous backfill use-case the jobs drive.
   * @param onUpdate - notified on every job state change (optional).
   * @param newId - job-id factory (defaults to a random UUID; injectable for tests).
   */
  constructor(
    private readonly backfill: BackfillService,
    private readonly onUpdate?: BackfillJobListener,
    private readonly newId: () => string = randomUUID,
  ) {}

  /**
   * Validate, then start a backfill in the background and return its `Running`
   * job. Validation is synchronous so client errors surface before a 202.
   *
   * @throws {@link import('@lametrader/core').SymbolNotFoundError} when not watched.
   * @throws {@link import('@lametrader/core').CandleError} when the period is not watched.
   * @throws {@link BackfillConflictError} when a job for `(id, period)` is already running.
   */
  async start(id: string, period: Period, range?: BackfillRange): Promise<BackfillJob> {
    await this.backfill.assertBackfillable(id, period);
    if (this.runningFor(id, period)) {
      throw new BackfillConflictError(`a backfill is already running for ${id} ${period}`);
    }
    const job: BackfillJob = {
      id: this.newId(),
      symbolId: id,
      period,
      status: BackfillJobStatus.Running,
      progress: null,
      summary: null,
      error: null,
    };
    this.jobs.set(job.id, job);
    this.emit(job);
    void this.run(job, range);
    return job;
  }

  /**
   * The job with `jobId`, or `null` if unknown.
   */
  get(jobId: string): BackfillJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  /**
   * Every job, in insertion order.
   */
  list(): BackfillJob[] {
    return [...this.jobs.values()];
  }

  /**
   * Run the backfill and drive `job` to its terminal state.
   */
  private async run(job: BackfillJob, range?: BackfillRange): Promise<void> {
    try {
      const summary = await this.backfill.backfill(job.symbolId, job.period, range, (progress) => {
        job.progress = progress;
        this.emit(job);
      });
      job.status = BackfillJobStatus.Succeeded;
      job.summary = summary;
    } catch (error) {
      job.status = BackfillJobStatus.Failed;
      job.error = (error as Error).message;
    }
    this.emit(job);
  }

  /**
   * Whether a job for `(id, period)` is currently running.
   */
  private runningFor(id: string, period: Period): boolean {
    for (const job of this.jobs.values()) {
      if (
        job.symbolId === id &&
        job.period === period &&
        job.status === BackfillJobStatus.Running
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Push a snapshot of `job` to the listener (copied so later mutation can't leak).
   */
  private emit(job: BackfillJob): void {
    this.onUpdate?.({ ...job });
  }
}
