/**
 * Thrown when the rule engine's cascading cycle limit is exceeded within one
 * evaluation tick — see ADR 0012.
 *
 * Caught by the orchestrator, which records a `CycleOverflow` event on the
 * offending rule + affected symbol and halts further cascading on that tick.
 */
export class CycleOverflowError extends Error {
  /**
   * @param limit - the limit that was breached (for context in the recorded
   *   event).
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
 * state-change event; `enter` throws once the count exceeds `limit`. Between
 * external ticks the orchestrator calls {@link reset} to clear the counter.
 */
export class CycleGuard {
  /** The current count within this tick. */
  private count = 0;

  /**
   * @param limit - the maximum number of cascaded re-entries permitted per
   *   tick. Default is `4` per ADR 0012.
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

  /**
   * Clear the counter so the next tick starts fresh.
   */
  reset(): void {
    this.count = 0;
  }
}
