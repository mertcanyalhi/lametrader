import { type RuleEvent, RuleEventKind } from '@lametrader/core';

/** One minute in milliseconds. */
const ONE_MINUTE_MS = 60_000;

/**
 * Per-minute timer event source for the rule engine.
 *
 * Emits one `TimerEvent` per wall-clock minute boundary; the orchestrator
 * fans it out to every watched symbol when deciding which rules to run.
 *
 * Uses a chained `setTimeout` (not `setInterval`) so a delayed callback never
 * leads to "make-up" overlapping fires — at most one fire is ever pending,
 * and each fire schedules the next one only after it lands.
 */
export class MinuteTimerSource {
  /** The pending fire's timer handle, or `null` when stopped. */
  private timeoutId: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param emit - the `RuleEvent` sink.
   * @param now - injectable clock (defaults to `Date.now`).
   */
  constructor(
    private readonly emit: (event: RuleEvent) => void,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Start firing on each minute boundary. Idempotent — calling `start()` when
   * already running is a no-op.
   */
  start(): void {
    if (this.timeoutId !== null) return;
    this.scheduleNext();
  }

  /**
   * Stop firing. Idempotent — calling `stop()` when already stopped is a
   * no-op.
   */
  stop(): void {
    if (this.timeoutId === null) return;
    clearTimeout(this.timeoutId);
    this.timeoutId = null;
  }

  /**
   * Compute the delay to the next minute boundary and arm one `setTimeout`.
   * Re-invoked from inside each fire to keep the chain going.
   */
  private scheduleNext(): void {
    const current = this.now();
    const nextBoundary = Math.ceil(current / ONE_MINUTE_MS) * ONE_MINUTE_MS;
    const delay = nextBoundary > current ? nextBoundary - current : ONE_MINUTE_MS;
    this.timeoutId = setTimeout(() => {
      this.timeoutId = null;
      this.emit({ kind: RuleEventKind.Timer, ts: this.now(), symbolId: null });
      this.scheduleNext();
    }, delay);
  }
}
