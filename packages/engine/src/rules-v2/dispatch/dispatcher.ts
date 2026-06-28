import { type Period, RulesV2 } from '@lametrader/core';

import { type GateLookups, gateAllows } from './gates.js';
import { routes } from './routes.js';

/**
 * The rules-v2 trigger dispatcher.
 *
 * Composes three concerns the orchestrator (#393) drives per inbound event:
 *
 * 1. **Routing** — does `event` reach `rule` at all? (`routes` from
 *    `./routes.js`)
 * 2. **Per-trigger gate** — given the gate state, may the rule fire now?
 *    (`gateAllows` from `./gates.js`)
 * 3. **Gate-state housekeeping** — `recordFire` latches OncePerBar / records
 *    OncePerInterval last-fire, `onBarOpened` clears OncePerBar latches.
 *
 * Stateful: owns an in-memory map of OncePerBar latches keyed by
 * `${ruleId}|${firingSymbolId}|${period}` and OncePerInterval last-fire
 * timestamps keyed by `ruleId`.
 * Fresh on each process start — the only persistent gating concern, `Once`,
 * is covered by `rule.enabled = false` (owned by the orchestrator).
 */
export class TriggerDispatcher {
  /** OncePerBar latches: `${ruleId}|${firingSymbolId}|${period}`. */
  private readonly latched = new Set<string>();
  /** OncePerInterval last-fire timestamps: `ruleId` → epoch-ms. */
  private readonly lastFire = new Map<string, number>();

  /** {@link GateLookups} view of the dispatcher's in-memory state. */
  private readonly lookups: GateLookups = {
    isLatched: (ruleId, firingSymbolId, period) =>
      this.latched.has(latchKey(ruleId, firingSymbolId, period)),
    lastFireAt: (ruleId) => this.lastFire.get(ruleId) ?? null,
  };

  /**
   * Returns `true` iff `event` routes to `rule`, `conditionTrue` is `true`,
   * and the per-trigger gate allows the fire. The orchestrator evaluates the
   * condition tree and passes the resulting boolean in.
   */
  decide(
    rule: RulesV2.Rule,
    event: RulesV2.EvaluationTriggerEvent,
    firingSymbolId: string,
    conditionTrue: boolean,
  ): boolean {
    if (!routes(event, rule)) return false;
    if (!conditionTrue) return false;
    return gateAllows(rule, event, firingSymbolId, this.lookups);
  }

  /**
   * Record that `rule` fired for `firingSymbolId` on `event`. Latches
   * OncePerBar for `(ruleId, firingSymbolId, period)` and records `event.ts`
   * as the last-fire timestamp for OncePerInterval. No-op for other trigger
   * kinds (their gate is stateless).
   */
  recordFire(
    rule: RulesV2.Rule,
    event: RulesV2.EvaluationTriggerEvent,
    firingSymbolId: string,
  ): void {
    switch (rule.trigger.kind) {
      case RulesV2.TriggerKind.OncePerBar:
        this.latched.add(latchKey(rule.id, firingSymbolId, rule.trigger.period));
        return;
      case RulesV2.TriggerKind.OncePerInterval:
        this.lastFire.set(rule.id, event.ts);
        return;
      case RulesV2.TriggerKind.EveryTime:
      case RulesV2.TriggerKind.Once:
      case RulesV2.TriggerKind.OncePerBarOpen:
      case RulesV2.TriggerKind.OncePerBarClose:
        return;
    }
  }

  /**
   * Clear every OncePerBar latch whose `(firingSymbolId, period)` matches —
   * called by the orchestrator on each `BarOpened` event to re-arm the gate
   * for the new bar window.
   */
  onBarOpened(symbolId: string, period: Period): void {
    const suffix = `|${symbolId}|${period}`;
    for (const key of this.latched) {
      if (key.endsWith(suffix)) this.latched.delete(key);
    }
  }
}

/** Build the OncePerBar latch key for `(ruleId, firingSymbolId, period)`. */
function latchKey(ruleId: string, firingSymbolId: string, period: Period): string {
  return `${ruleId}|${firingSymbolId}|${period}`;
}
