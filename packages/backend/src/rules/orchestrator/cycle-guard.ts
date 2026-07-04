/**
 * Thrown when the rule engine's cascading cycle limit is exceeded within
 * one evaluation tick — preserves ADR 0012's semantics.
 *
 * Caught by the orchestrator, which records a `CycleOverflow` rule event on
 * the affected symbol and halts further cascading on that tick.
 */
export class CycleOverflowError extends Error {
  /**
   * @param limit - the breached limit (carried so the recorded event can
   *   surface it).
   */
  constructor(public readonly limit: number) {
    super(`Cycle limit of ${limit} exceeded within one evaluation tick.`);
    this.name = 'CycleOverflowError';
  }
}

/**
 * A per-tick counter that bounds cascading state-change re-entries (ADR 0012).
 *
 * The orchestrator calls {@link enter} once before processing each cascaded
 * event; `enter` throws once the count exceeds `limit`. Between external
 * ticks a fresh guard is constructed (no reset needed — short-lived).
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
}
