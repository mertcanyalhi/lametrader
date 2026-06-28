import { type Period, RulesV2 } from '@lametrader/core';

/**
 * Read-side surface the per-trigger gates dispatch into for state lookups.
 *
 * Held by the {@link TriggerDispatcher} in-memory; latch + last-fire state
 * are fresh on each process start (the only persistent gating concern,
 * `Once`, is covered by `rule.enabled = false` after first fire — owned by
 * the orchestrator, not the gate).
 */
export interface GateLookups {
  /** Whether `(ruleId, firingSymbolId, period)` has an active OncePerBar latch. */
  isLatched(ruleId: string, firingSymbolId: string, period: Period): boolean;
  /** Latest recorded fire timestamp for `ruleId`, or `null` if never fired. */
  lastFireAt(ruleId: string): number | null;
}

/**
 * Decide whether `rule`'s trigger gate allows a fire for `event` against the
 * current gate state in `lookups`.
 *
 * Pure: every gate-state read goes through `lookups`; no I/O.
 *
 * - `EveryTime` / `Once` — always allow (auto-disable for `Once` is the
 *   orchestrator's concern via `rule.enabled`).
 * - `OncePerBar` — allow iff `(ruleId, firingSymbolId, period)` is not
 *   latched. The orchestrator latches it on fire and the dispatcher clears
 *   it on the next `BarOpened` for the matching `(symbolId, period)`.
 * - `OncePerBarOpen` / `OncePerBarClose` — always allow on routed events;
 *   the bar-lifecycle event itself enforces "once per bar".
 * - `OncePerInterval` — allow iff no prior fire is recorded or
 *   `event.ts - lastFireAt(ruleId) >= intervalMs`.
 */
export function gateAllows(
  rule: RulesV2.Rule,
  event: RulesV2.EvaluationTriggerEvent,
  firingSymbolId: string,
  lookups: GateLookups,
): boolean {
  switch (rule.trigger.kind) {
    case RulesV2.TriggerKind.EveryTime:
    case RulesV2.TriggerKind.Once:
    case RulesV2.TriggerKind.OncePerBarOpen:
    case RulesV2.TriggerKind.OncePerBarClose:
      return true;
    case RulesV2.TriggerKind.OncePerBar:
      return !lookups.isLatched(rule.id, firingSymbolId, rule.trigger.period);
    case RulesV2.TriggerKind.OncePerInterval: {
      const last = lookups.lastFireAt(rule.id);
      if (last === null) return true;
      return event.ts - last >= rule.trigger.intervalMs;
    }
  }
}
