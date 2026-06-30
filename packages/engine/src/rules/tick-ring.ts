import { type StateValue, StateValueType } from '@lametrader/core';

import type { SeriesPoint, SeriesView } from './series.types.js';

/**
 * Max number of ticks held per symbol in the in-memory ring buffer.
 *
 * Sized for the deepest lookback a Crossing / Channel / Moving operator
 * realistically needs while still being a hard wall against runaway memory.
 * Hard-coded by design — ticks are ephemeral (lost on restart) per ADR 0016
 * pillar 4, so the cap is engine-wide not per-rule.
 *
 * Once exceeded, the oldest tick is evicted on push (FIFO).
 */
export const TICK_RING_CAPACITY = 1024;

/**
 * Bounded in-memory ring buffer of {@link SeriesPoint}s for one symbol's tick
 * stream, conforming to {@link SeriesView}.
 *
 * Hybrid storage per ADR 0016 — ticks are ephemeral (no persistence); a
 * fresh ring replaces them on restart and the engine catches up from the
 * live `QuoteStreamService` (#392 bridges).
 */
export class TickRing implements SeriesView {
  /** Buffer slots; `null` for empty. Length stays at `TICK_RING_CAPACITY`. */
  private readonly slots: (SeriesPoint | null)[] = new Array(TICK_RING_CAPACITY).fill(null);
  /** Index of the next write slot (wraps modulo capacity). */
  private head = 0;
  /** Current populated count (caps at `TICK_RING_CAPACITY`). */
  private populated = 0;

  /** Number of ticks currently held (≤ `TICK_RING_CAPACITY`). */
  get length(): number {
    return this.populated;
  }

  /**
   * Append a new tick at `(ts, price)`. Evicts the oldest tick when the
   * buffer is full.
   *
   * Ticks must arrive non-decreasing in `ts` — the caller (bridge) is the
   * `QuoteStreamService` which emits in arrival order. `asOf` and
   * `backwardWalk` assume that invariant.
   */
  push(ts: number, price: number): void {
    const value: StateValue = { type: StateValueType.Number, value: price };
    this.slots[this.head] = { ts, value };
    this.head = (this.head + 1) % TICK_RING_CAPACITY;
    if (this.populated < TICK_RING_CAPACITY) {
      this.populated += 1;
    }
  }

  /**
   * Iterate the buffer newest-first.
   */
  *backwardWalk(): IterableIterator<SeriesPoint> {
    for (let i = 0; i < this.populated; i += 1) {
      // `head` points to the next write slot, so `head-1` is the newest.
      const index = (this.head - 1 - i + TICK_RING_CAPACITY) % TICK_RING_CAPACITY;
      // Lazy: index math keeps `slots[index]` non-null but TS can't see that;
      // narrow explicitly rather than asserting non-null.
      const point = this.slots[index];
      if (point !== null && point !== undefined) {
        yield point;
      }
    }
  }

  /**
   * Latest tick with `ts <= queryTs`, or `null` when none qualify.
   *
   * Walks backwards (newest-first) and returns the first point whose `ts`
   * satisfies the bound — `O(populated)` in the worst case (a query against
   * the past); typical "live" queries hit the very first slot.
   */
  asOf(queryTs: number): SeriesPoint | null {
    for (const point of this.backwardWalk()) {
      if (point.ts <= queryTs) return point;
    }
    return null;
  }
}
