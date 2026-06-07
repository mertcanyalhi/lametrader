import type { BackfillProgress, BackfillSummary } from '@lametrader/engine';

/**
 * A frame pushed to WebSocket subscribers of a symbol's backfill progress:
 * either a per-chunk `progress` update or the terminal `summary`.
 */
export type BackfillProgressFrame =
  | { type: 'progress'; saved: number; total: number }
  | { type: 'summary'; summary: BackfillSummary };

/**
 * A subscriber notified of a symbol's backfill progress frames.
 */
export type BackfillProgressSubscriber = (frame: BackfillProgressFrame) => void;

/**
 * A tiny in-process pub/sub fanning backfill progress out to WebSocket
 * subscribers, keyed by symbol id. Lives in the API adapter so the application's
 * `BackfillService` stays a plain `onProgress` callback with no transport
 * knowledge.
 */
export class BackfillProgressHub {
  /**
   * Subscribers keyed by canonical symbol id.
   */
  private readonly subscribers = new Map<string, Set<BackfillProgressSubscriber>>();

  /**
   * Subscribe to a symbol's backfill frames.
   *
   * @returns an unsubscribe function.
   */
  subscribe(id: string, subscriber: BackfillProgressSubscriber): () => void {
    const set = this.subscribers.get(id) ?? new Set();
    set.add(subscriber);
    this.subscribers.set(id, set);
    return () => {
      set.delete(subscriber);
      if (set.size === 0) this.subscribers.delete(id);
    };
  }

  /**
   * Publish a progress update for a symbol to its subscribers.
   */
  progress(id: string, progress: BackfillProgress): void {
    this.emit(id, { type: 'progress', saved: progress.saved, total: progress.total });
  }

  /**
   * Publish the terminal summary for a symbol's backfill to its subscribers.
   */
  summary(id: string, summary: BackfillSummary): void {
    this.emit(id, { type: 'summary', summary });
  }

  /**
   * Fan a frame out to a symbol's current subscribers.
   */
  private emit(id: string, frame: BackfillProgressFrame): void {
    for (const subscriber of this.subscribers.get(id) ?? []) {
      subscriber(frame);
    }
  }
}
