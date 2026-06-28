import {
  type EventLog,
  type FiringStateRepository,
  type Period,
  periodMillis,
  type Rule,
  type RuleEvent,
  type RuleEventEntry,
  RuleEventType,
  type Trigger,
  TriggerKind,
} from '@lametrader/core';

import { getLogger } from '../log.js';
import { GateReason } from './rule-orchestrator-trace.types.js';

/** Scope-bound logger for the trigger evaluator. */
const log = getLogger('trigger-evaluator');

/**
 * Owns trigger-gate dispatch and the firing-state side effect.
 *
 * Reads the rule's events log + per-(rule, symbol) firing-state to dispatch
 * on `rule.trigger.kind`, returning `true` when the rule may fire on
 * `firingSymbolId` for `event` given that the condition tree evaluated to
 * `conditionTrue` this tick.
 *
 * Performs the firing-state side-effect: writes the new `currentlyActive`
 * flag (`= conditionTrue`) so the `OncePerMinute` edge gate sees this tick
 * as "previous" on the next call. The write is unconditional so the edge
 * survives a min-interval suppression.
 *
 * Emits one `gate_decision` trace per call (#354) with the forensic
 * `reason` string from {@link GateReason}.
 */
export class TriggerEvaluator {
  constructor(
    private readonly eventLog: EventLog,
    private readonly firingState: FiringStateRepository,
  ) {}

  /**
   * Decide whether `rule` may fire on `firingSymbolId` for `event`, given
   * that the condition tree evaluated to `conditionTrue` this tick.
   *
   * Persists the new `currentlyActive` flag (`= conditionTrue`) unconditionally
   * so the next `OncePerMinute` evaluation sees this tick as "previous".
   */
  async mayFire(
    rule: Rule,
    event: RuleEvent,
    firingSymbolId: string,
    conditionTrue: boolean,
  ): Promise<boolean> {
    const events = await this.eventLog.ruleEvents(rule.id);
    const prevActive = await this.firingState.getActive(rule.id, firingSymbolId);
    const final = eventFinal(event);
    const allowed = dispatch(
      rule.trigger,
      events,
      firingSymbolId,
      event.ts,
      prevActive,
      conditionTrue,
      final,
    );
    await this.firingState.setActive(rule.id, firingSymbolId, conditionTrue);
    log.trace(
      {
        ruleId: rule.id,
        triggerKind: rule.trigger.kind,
        allowed,
        reason: gateReason(rule.trigger, allowed, final, prevActive, conditionTrue),
        eventTime: new Date(event.ts).toISOString(),
      },
      'gate_decision',
    );
    return allowed;
  }
}

/**
 * Dispatch on `trigger.kind` to the right gate; `OncePerMinute` and the
 * bar-based variants need extra context which is threaded in here.
 */
function dispatch(
  trigger: Trigger,
  events: RuleEventEntry[],
  symbolId: string,
  ts: number,
  prevActive: boolean,
  nowActive: boolean,
  final: boolean,
): boolean {
  switch (trigger.kind) {
    case TriggerKind.Once:
      return evaluateOnce(events, symbolId);
    case TriggerKind.OncePerBar:
      return evaluateOncePerBar(events, symbolId, ts, trigger.period);
    case TriggerKind.OncePerBarClose:
      return evaluateOncePerBarClose(events, symbolId, ts, trigger.period, final);
    case TriggerKind.OncePerMinute:
      return evaluateOncePerMinute(events, symbolId, ts, trigger.intervalMs, prevActive, nowActive);
  }
}

/**
 * The `Once` gate.
 *
 * Returns `true` when no prior `Fired` event exists for `symbolId` on the
 * rule's embedded events log.
 */
function evaluateOnce(events: RuleEventEntry[], symbolId: string): boolean {
  for (const event of events) {
    if (event.type === RuleEventType.Fired && event.symbolId === symbolId) return false;
  }
  return true;
}

/**
 * The `OncePerBar` gate.
 *
 * Returns `true` when no prior `Fired` event for `symbolId` lands in the same
 * `period` bar as `currentTs`.
 */
function evaluateOncePerBar(
  events: RuleEventEntry[],
  symbolId: string,
  currentTs: number,
  period: Period,
): boolean {
  const last = lastFiredAt(events, symbolId);
  if (last === null) return true;
  return barStart(last, period) !== barStart(currentTs, period);
}

/**
 * The `OncePerBarClose` gate.
 *
 * Combines {@link evaluateOncePerBar} with a `final` check — a forming bar
 * never satisfies this trigger, regardless of prior fires.
 */
function evaluateOncePerBarClose(
  events: RuleEventEntry[],
  symbolId: string,
  currentTs: number,
  period: Period,
  final: boolean,
): boolean {
  if (!final) return false;
  return evaluateOncePerBar(events, symbolId, currentTs, period);
}

/**
 * The `OncePerMinute` gate.
 *
 * Fires once when the rule's condition becomes true (false → true), then
 * stays silent while it remains true; re-arms when it flips false. A
 * `min-interval` guard suppresses additional fires within `intervalMs` of the
 * previous fire to absorb flapping.
 */
function evaluateOncePerMinute(
  events: RuleEventEntry[],
  symbolId: string,
  currentTs: number,
  intervalMs: number,
  prevActive: boolean,
  nowActive: boolean,
): boolean {
  if (!nowActive) return false;
  if (prevActive) return false;
  const last = lastFiredAt(events, symbolId);
  if (last !== null && currentTs - last < intervalMs) return false;
  return true;
}

/**
 * Latest `ts` of a `Fired` event for `symbolId`, or `null` if none.
 */
function lastFiredAt(events: RuleEventEntry[], symbolId: string): number | null {
  let latest: number | null = null;
  for (const event of events) {
    if (event.type === RuleEventType.Fired && event.symbolId === symbolId) {
      if (latest === null || event.ts > latest) latest = event.ts;
    }
  }
  return latest;
}

/**
 * Align an epoch-ms timestamp to the open of the bar it falls into.
 */
function barStart(ts: number, period: Period): number {
  const ms = periodMillis(period);
  return Math.floor(ts / ms) * ms;
}

/**
 * Whether the inbound event represents a final bar; only OHLCV events carry
 * `final` (non-OHLCV events read as forming).
 */
function eventFinal(event: RuleEvent): boolean {
  if ('final' in event) return event.final;
  return false;
}

/**
 * The forensic `reason` string for one trigger-gate dispatch — one of a
 * fixed vocabulary so the trace is grep-friendly. Computed at the
 * call site (the gate functions themselves only return booleans).
 */
function gateReason(
  trigger: Trigger,
  allowed: boolean,
  final: boolean,
  prevActive: boolean,
  nowActive: boolean,
): GateReason {
  if (allowed) return GateReason.Allowed;
  switch (trigger.kind) {
    case TriggerKind.Once:
      return GateReason.AlreadyFired;
    case TriggerKind.OncePerBar:
      return GateReason.SameBar;
    case TriggerKind.OncePerBarClose:
      return !final ? GateReason.NotFinal : GateReason.SameBar;
    case TriggerKind.OncePerMinute:
      if (!nowActive) return GateReason.NotActive;
      if (prevActive) return GateReason.NoTransition;
      return GateReason.WithinInterval;
  }
}
