import { RulesV2 } from '@lametrader/core';

/**
 * Decide whether an evaluation-trigger event admits a rule with the given
 * trigger — pure, exclusive routing per ADR 0016.
 *
 * `Tick` events drive only per-tick triggers (`EveryTime` / `Once` /
 * `OncePerBar`). `BarOpened` / `BarClosed` events drive only the matching
 * bar-cadence trigger AND only when the bar period matches the trigger's.
 * `Timer` events drive only `OncePerInterval` (the gate decides whether
 * `intervalMs` has elapsed).
 *
 * Cascade events (`SymbolStateChanged` / `GlobalStateChanged` /
 * `IndicatorChanged`) are not handled here — they're routed by
 * `referencesSlot` against the rule's condition tree.
 */
export function routes(event: RulesV2.EvaluationTriggerEvent, trigger: RulesV2.Trigger): boolean {
  switch (trigger.kind) {
    case RulesV2.TriggerKind.EveryTime:
    case RulesV2.TriggerKind.Once:
    case RulesV2.TriggerKind.OncePerBar:
      return event.kind === RulesV2.EvaluationTriggerKind.Tick;
    case RulesV2.TriggerKind.OncePerBarOpen:
      return (
        event.kind === RulesV2.EvaluationTriggerKind.BarOpened && event.period === trigger.period
      );
    case RulesV2.TriggerKind.OncePerBarClose:
      return (
        event.kind === RulesV2.EvaluationTriggerKind.BarClosed && event.period === trigger.period
      );
    case RulesV2.TriggerKind.OncePerInterval:
      return event.kind === RulesV2.EvaluationTriggerKind.Timer;
  }
}
