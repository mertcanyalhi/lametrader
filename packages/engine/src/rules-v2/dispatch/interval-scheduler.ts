import { RulesV2 } from '@lametrader/core';

/**
 * Sink invoked when a {@link IntervalScheduler}'s timer fires.
 *
 * Receives the emitted Timer event plus the `ruleId` whose schedule produced
 * it, so the dispatcher can route the timer to that single rule.
 */
export type IntervalEmit = (event: RulesV2.TimerEvent, ruleId: string) => void;

/**
 * Wall-clock scheduler arming one chained `setTimeout` per
 * `OncePerInterval`-triggered rule.
 *
 * Each rule's chain emits a `RulesV2.TimerEvent` whose `ts` is the boundary
 * time, then schedules the next emission. A chained `setTimeout` (not
 * `setInterval`) — see {@link MinuteTimerSource} in v1 for the same pattern —
 * keeps a delayed callback from producing "make-up" overlapping fires.
 *
 * Independent per `ruleId`: starting two rules with different `intervalMs`
 * runs two separate timers, each on its own cadence.
 *
 * Lazy: no wall-clock alignment to interval boundaries (e.g. starting a 60s
 * timer at ts=12 fires at 72/132/…, not 60/120/…). The orchestrator (#393)
 * decides when to call `start` and whether alignment matters. Upgrade path:
 * accept a `now()` injection and offset the first delay to align.
 */
export class IntervalScheduler {
  /** Active timer handles, keyed by `ruleId`. */
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * @param emit - sink invoked on each scheduled tick.
   * @param now - injectable clock (defaults to `Date.now`).
   */
  constructor(
    private readonly emit: IntervalEmit,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Start emitting Timer events at `trigger.intervalMs` for `ruleId`.
   *
   * Idempotent — starting an already-started rule is a no-op (the existing
   * timer keeps running).
   */
  start(ruleId: string, trigger: RulesV2.OncePerIntervalTrigger): void {
    if (this.timers.has(ruleId)) return;
    this.scheduleNext(ruleId, trigger.intervalMs);
  }

  /**
   * Stop emitting Timer events for `ruleId`.
   *
   * Idempotent — stopping an unknown id is a no-op.
   */
  stop(ruleId: string): void {
    const handle = this.timers.get(ruleId);
    if (handle === undefined) return;
    clearTimeout(handle);
    this.timers.delete(ruleId);
  }

  /**
   * Arm one chained `setTimeout` for `ruleId`, re-arming from inside the
   * callback to keep the chain going until `stop` clears it.
   *
   * Re-arm decision: capture the handle in a closure, then after `emit`
   * check whether the stored handle is still ours — if `stop` ran during
   * `emit` it cleared (or replaced) the stored handle and we bail out.
   */
  private scheduleNext(ruleId: string, intervalMs: number): void {
    const handle = setTimeout(() => {
      this.emit({ kind: RulesV2.EvaluationTriggerKind.Timer, ts: this.now() }, ruleId);
      // If `stop` ran during emit it removed our handle from the map; only
      // re-arm when our handle is still the one stored.
      if (this.timers.get(ruleId) !== handle) return;
      this.timers.delete(ruleId);
      this.scheduleNext(ruleId, intervalMs);
    }, intervalMs);
    this.timers.set(ruleId, handle);
  }
}
