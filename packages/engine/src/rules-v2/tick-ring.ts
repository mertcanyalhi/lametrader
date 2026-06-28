import type { SeriesSample, SeriesView } from './series.types.js';

/**
 * Documented capacity of a per-symbol {@link TickRingBuffer}.
 *
 * Bounded so a long-running session can't drift into unbounded memory growth.
 * Sized for a few hours of tick traffic on a single instrument at typical
 * arrival rates; tune up if a profile demands deeper tick lookback for a
 * Moving / Crossing operator.
 */
export const TICK_RING_CAPACITY = 10_000;

/**
 * Bounded in-memory ring buffer of recent ticks for one symbol.
 *
 * Provides the {@link SeriesView} surface every series-aware operator reads —
 * ticks are ephemeral by nature (CONTEXT.md / ADR 0016), so no persistence.
 * FIFO eviction drops the oldest sample once {@link TICK_RING_CAPACITY} is
 * reached.
 */
export class TickRingBuffer implements SeriesView {
  private readonly buffer: SeriesSample[] = [];

  constructor(readonly capacity: number = TICK_RING_CAPACITY) {}

  /**
   * Append one tick to the buffer. Evicts the oldest sample if the buffer
   * would exceed {@link capacity}.
   *
   * Caller is expected to push in ascending `ts` order (the live quote stream
   * is monotone). Out-of-order pushes are stored as-is; lookup methods walk
   * the buffer linearly and behave as if the array were authoritative.
   */
  push(ts: number, value: number): void {
    this.buffer.push({ ts, value });
    if (this.buffer.length > this.capacity) {
      this.buffer.shift();
    }
  }

  length(): number {
    return this.buffer.length;
  }

  samples(): readonly SeriesSample[] {
    return this.buffer;
  }

  latest(): SeriesSample | null {
    return this.buffer.length === 0 ? null : (this.buffer[this.buffer.length - 1] as SeriesSample);
  }

  asOf(asOfTs: number): SeriesSample | null {
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      const sample = this.buffer[i] as SeriesSample;
      if (sample.ts <= asOfTs) return sample;
    }
    return null;
  }
}
