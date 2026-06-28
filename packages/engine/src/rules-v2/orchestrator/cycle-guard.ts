/**
 * Thrown when the v2 rule engine's cascading cycle limit is exceeded within
 * one evaluation tick — see ADR 0012 (carried forward into rules-v2).
 *
 * Caught by the orchestrator, which records a `CycleOverflow` event on the
 * offending symbol's events log and halts further cascading on that tick.
 */
export class CycleOverflowError extends Error {
  /**
   * @param limit - the breached limit (echoed into the recorded
   *   `CycleOverflow` rule event).
   */
  constructor(public readonly limit: number) {
    super(`Cycle limit of ${limit} exceeded within one evaluation tick.`);
    this.name = 'CycleOverflowError';
  }
}

/**
 * A per-tick counter that bounds cascading state-change re-entries — see
 * ADR 0012.
 *
 * The orchestrator calls {@link enter} once before processing each cascaded
 * state-change event; `enter` throws once the count exceeds `limit`.
 */
export class CycleGuard {
  /** The current count within this tick. */
  private count = 0;

  /**
   * @param limit - the maximum number of cascaded re-entries permitted per
   *   tick.
   */
  constructor(public readonly limit: number) {}

  /**
   * Record one cascaded re-entry. Throws once the count exceeds `limit`.
   *
   * @throws {CycleOverflowError} when the cumulative count exceeds `limit`.
   */
  enter(): void {
    this.count++;
    if (this.count > this.limit) {
      throw new CycleOverflowError(this.limit);
    }
  }

  /** Clear the counter so the next tick starts fresh. */
  reset(): void {
    this.count = 0;
  }
}
