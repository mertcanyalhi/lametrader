import type { BackfillJob } from '@lametrader/engine';

/**
 * A subscriber notified of a backfill job's state changes.
 */
export type BackfillJobSubscriber = (job: BackfillJob) => void;

/**
 * A tiny in-process pub/sub fanning {@link BackfillJob} updates out to WebSocket
 * subscribers, keyed by **job id** (so concurrent jobs never interleave). Lives in
 * the API adapter so the application's `BackfillJobService` stays a plain
 * `onUpdate` callback with no transport knowledge (ADR-0005 / ADR-0008).
 */
export class BackfillJobHub {
  /**
   * Subscribers keyed by job id.
   */
  private readonly subscribers = new Map<string, Set<BackfillJobSubscriber>>();

  /**
   * Subscribe to a job's updates.
   *
   * @returns an unsubscribe function.
   */
  subscribe(jobId: string, subscriber: BackfillJobSubscriber): () => void {
    const set = this.subscribers.get(jobId) ?? new Set();
    set.add(subscriber);
    this.subscribers.set(jobId, set);
    return () => {
      set.delete(subscriber);
      if (set.size === 0) this.subscribers.delete(jobId);
    };
  }

  /**
   * Publish a job snapshot to its subscribers.
   */
  publish(jobId: string, job: BackfillJob): void {
    for (const subscriber of this.subscribers.get(jobId) ?? []) {
      subscriber(job);
    }
  }
}
