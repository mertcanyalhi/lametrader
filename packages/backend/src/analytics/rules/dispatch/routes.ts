import {
  type EvaluationTriggerEvent,
  EvaluationTriggerKind,
  type Trigger,
  TriggerKind,
} from '@lametrader/core';

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
export function routes(event: EvaluationTriggerEvent, trigger: Trigger): boolean {
  switch (trigger.kind) {
    case TriggerKind.EveryTime:
    case TriggerKind.Once:
    case TriggerKind.OncePerBar:
      return event.kind === EvaluationTriggerKind.Tick;
    case TriggerKind.OncePerBarOpen:
      return event.kind === EvaluationTriggerKind.BarOpened && event.period === trigger.period;
    case TriggerKind.OncePerBarClose:
      return event.kind === EvaluationTriggerKind.BarClosed && event.period === trigger.period;
    case TriggerKind.OncePerInterval:
      return event.kind === EvaluationTriggerKind.Timer;
  }
}
