import {
  type Action,
  ActionKind,
  type EvaluationTriggerEvent,
  EvaluationTriggerKind,
  type FiredRuleEvent,
  type NotificationAction,
  type Notifier,
  type Period,
  type RemoveGlobalStateAction,
  type RemoveSymbolStateAction,
  type Rule,
  type RuleEventEntry,
  type RuleEventLookupSnapshot,
  RuleEventType,
  type SetGlobalStateAction,
  type SetSymbolStateAction,
  type StateRepository,
  StateScope,
  type StateValue,
  StateValueType,
  TriggerKind,
} from '@lametrader/core';
import { UnknownDestinationError } from '../../../common/domain/notifier.js';
import { collectConditionIntervals } from '../../../common/domain/rules/condition-validate.js';

import { getLogger } from '../engine-log.js';
import type { EvaluationLookups } from '../wire/live-evaluation-lookups.types.js';

/**
 * Scope-bound logger for the action-runner surface — one
 * `action_executed` trace per action lands under `engine.rules.actions`
 * (per #436 / spec rules-trace-scope-logging).
 */
const log = getLogger('engine.rules.actions');

/**
 * The subset of {@link Action}s that mutate state — the input shape
 * {@link ActionRunner.runStateAction} consumes.
 */
type StateMutationAction =
  | SetSymbolStateAction
  | RemoveSymbolStateAction
  | SetGlobalStateAction
  | RemoveGlobalStateAction;

/**
 * Application use-case that executes every action on one firing rule and
 * returns the rule-event entries to commit.
 *
 * Per-action mutations (state writes, notifier sends) happen as side effects
 * during {@link run}. Event-log appends are NOT — the orchestrator commits
 * the returned list as one batch so "events emitted by one fire" have one
 * source of truth.
 *
 * Each per-action entry maps as:
 *   - `SetSymbolState` / `SetGlobalState`         → `StateSet` entry
 *   - `RemoveSymbolState` / `RemoveGlobalState`   → `StateRemoved` entry
 *   - `Notification` (telegram, success)          → `NotificationSent` entry
 *   - `Notification` (template / destination / transport failure) → `Error` entry
 *
 * The trailing `Fired` umbrella entry includes the captured OHLCV snapshot
 * for the firing symbol from the orchestrator's `lookups` cache.
 */
export class ActionRunner {
  constructor(
    private readonly state: StateRepository,
    private readonly notifier: Notifier,
    private readonly lookups: EvaluationLookups,
  ) {}

  /**
   * Execute every action on `rule` for `firingSymbolId` driven by `event`.
   * Returns the rule-event entries for one complete fire — per-action entries
   * followed by the trailing `Fired` umbrella.
   */
  async run(
    rule: Rule,
    firingSymbolId: string,
    ts: number,
    event: EvaluationTriggerEvent,
  ): Promise<RuleEventEntry[]> {
    const entries: RuleEventEntry[] = [];
    for (const action of rule.actions) {
      const startedAt = nowMs();
      const entry = isStateAction(action)
        ? await this.runStateAction(action, rule, firingSymbolId, ts)
        : await this.runNotificationAction(action, rule.id, firingSymbolId, ts, event);
      entries.push(entry);
      if (log.isLevelEnabled('trace')) {
        log.trace(
          {
            ruleId: rule.id,
            actionKind: action.kind,
            payload: action,
            outcome: entry.type === RuleEventType.Error ? 'error' : 'ok',
            durationMs: nowMs() - startedAt,
          },
          'action_executed',
        );
      }
    }
    const fired: FiredRuleEvent = {
      type: RuleEventType.Fired,
      ts,
      ruleId: rule.id,
      symbolId: firingSymbolId,
      context: {
        inboundEvent: event,
        lookupSnapshot: this.snapshot(firingSymbolId, snapshotPeriodFor(rule)),
      },
    };
    entries.push(fired);
    return entries;
  }

  /**
   * Apply one state mutation through {@link StateRepository} and produce the
   * matching `StateSet` / `StateRemoved` rule-event entry.
   */
  private async runStateAction(
    action: StateMutationAction,
    rule: Rule,
    firingSymbolId: string,
    ts: number,
  ): Promise<RuleEventEntry> {
    switch (action.kind) {
      case ActionKind.SetSymbolState:
        await this.state.setSymbolState(
          rule.profileId,
          firingSymbolId,
          action.key,
          action.value,
          ts,
        );
        return {
          type: RuleEventType.StateSet,
          ts,
          ruleId: rule.id,
          symbolId: firingSymbolId,
          scope: StateScope.Symbol,
          key: action.key,
          value: action.value,
        };
      case ActionKind.RemoveSymbolState:
        await this.state.removeSymbolState(rule.profileId, firingSymbolId, action.key, ts);
        return {
          type: RuleEventType.StateRemoved,
          ts,
          ruleId: rule.id,
          symbolId: firingSymbolId,
          scope: StateScope.Symbol,
          key: action.key,
        };
      case ActionKind.SetGlobalState:
        await this.state.setGlobalState(rule.profileId, action.key, action.value, ts);
        return {
          type: RuleEventType.StateSet,
          ts,
          ruleId: rule.id,
          symbolId: firingSymbolId,
          scope: StateScope.Global,
          key: action.key,
          value: action.value,
        };
      case ActionKind.RemoveGlobalState:
        await this.state.removeGlobalState(rule.profileId, action.key, ts);
        return {
          type: RuleEventType.StateRemoved,
          ts,
          ruleId: rule.id,
          symbolId: firingSymbolId,
          scope: StateScope.Global,
          key: action.key,
        };
    }
  }

  /**
   * Render the template, send through {@link Notifier}, and produce a
   * `NotificationSent` entry on success or an `Error` entry on template /
   * destination / transport failure.
   *
   * Only the telegram channel ships today (per ADR 0016 / #393); new channels
   * add new payload shapes under the same `Notification` kind.
   */
  private async runNotificationAction(
    action: NotificationAction,
    ruleId: string,
    firingSymbolId: string,
    ts: number,
    event: EvaluationTriggerEvent,
  ): Promise<RuleEventEntry> {
    const render = renderTemplate(action.template, buildVars(event, firingSymbolId, ts));
    if (!render.ok) {
      return errorEntry(
        `unknown template token: {${render.unknownToken}}`,
        ruleId,
        firingSymbolId,
        ts,
      );
    }
    try {
      await this.notifier.send(action.destinationName, render.body);
    } catch (error) {
      const reason =
        error instanceof UnknownDestinationError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      return errorEntry(reason, ruleId, firingSymbolId, ts);
    }
    return {
      type: RuleEventType.NotificationSent,
      ts,
      ruleId,
      symbolId: firingSymbolId,
      destinationName: action.destinationName,
      body: render.body,
    };
  }

  /**
   * Snapshot the firing symbol's OHLCV lookups for the `Fired.context`
   * payload — captures what the rule actually saw when its actions ran.
   *
   * OHLCV is read at `period` (the rule's referenced interval, see
   * {@link snapshotPeriodFor}) and the period is stamped on the snapshot so a
   * reader can attribute the values to the right bar. When the rule references
   * no OHLCV operand (`period` undefined), the OHLCV axes are `null` and the
   * `period` field is omitted (a period-less snapshot, same shape legacy
   * entries deserialize as). `current` (the tick price) is always period-less.
   */
  private snapshot(firingSymbolId: string, period: Period | undefined): RuleEventLookupSnapshot {
    const current = this.lookups.getCurrentValue(firingSymbolId);
    if (period === undefined) {
      return { current, open: null, high: null, low: null, close: null, volume: null };
    }
    return {
      period,
      current,
      open: this.lookups.getOpenValue(firingSymbolId, period),
      high: this.lookups.getHighValue(firingSymbolId, period),
      low: this.lookups.getLowValue(firingSymbolId, period),
      close: this.lookups.getCloseValue(firingSymbolId, period),
      volume: this.lookups.getVolumeValue(firingSymbolId, period),
    };
  }
}

/**
 * The bar period a fire's OHLCV snapshot is captured at.
 *
 * For a bar-cadence trigger (`OncePerBarOpen` / `OncePerBarClose`) it's the
 * trigger's period; otherwise the first OHLCV interval referenced by the
 * condition; `undefined` when the rule references no OHLCV operand.
 *
 * Lazy: a rule referencing two OHLCV intervals snapshots the first one only —
 * the single-axis snapshot shape holds one period. Upgrade path: a per-period
 * snapshot map when a multi-interval rule needs every axis captured.
 */
function snapshotPeriodFor(rule: Rule): Period | undefined {
  if (
    rule.trigger.kind === TriggerKind.OncePerBarOpen ||
    rule.trigger.kind === TriggerKind.OncePerBarClose
  ) {
    return rule.trigger.period;
  }
  return collectConditionIntervals(rule.condition)[0];
}

/**
 * High-resolution monotonic clock — wraps `performance.now()` so the
 * `durationMs` field on the `action_executed` trace stays sub-millisecond
 * even when an action runs in well under one wall-clock tick.
 */
function nowMs(): number {
  return performance.now();
}

/** Outcome of `renderTemplate` — either the rendered body or the first unknown token. */
type RenderResult = { ok: true; body: string } | { ok: false; unknownToken: string };

/** Variables available inside a notification template. */
interface Vars {
  symbolId: string;
  ts: string;
  prev: string;
  current: string;
}

/** Narrow `Action` to the state-mutation subset. */
function isStateAction(action: Action): action is StateMutationAction {
  return (
    action.kind === ActionKind.SetSymbolState ||
    action.kind === ActionKind.RemoveSymbolState ||
    action.kind === ActionKind.SetGlobalState ||
    action.kind === ActionKind.RemoveGlobalState
  );
}

/**
 * Render `{name}` placeholders in `template` from `vars`. Returns the first
 * unknown token (if any) so the caller can record a precise error.
 */
function renderTemplate(template: string, vars: Vars): RenderResult {
  const tokens = template.matchAll(/\{(\w+)\}/g);
  for (const match of tokens) {
    const name = match[1];
    if (name === undefined || !(name in vars)) {
      return { ok: false, unknownToken: name ?? '' };
    }
  }
  const body = template.replace(/\{(\w+)\}/g, (_, name) => vars[name as keyof Vars]);
  return { ok: true, body };
}

/**
 * Build the fixed allow-list of template variables. Cascade events carry
 * their own `prev` / `current`; tick / bar events carry neither (those
 * tokens render as the empty string).
 */
function buildVars(event: EvaluationTriggerEvent, firingSymbolId: string, ts: number): Vars {
  const prevCurrent = extractPrevCurrent(event);
  return {
    symbolId: firingSymbolId,
    ts: String(ts),
    prev: stringifyStateValue(prevCurrent.prev),
    current: stringifyStateValue(prevCurrent.current),
  };
}

/**
 * Pull `(prev, current)` from the inbound event for template rendering.
 *
 * - Cascade events (state / indicator change) carry both axes natively.
 * - `Tick` carries `current` as the tick price (wrapped as a numeric
 *   {@link StateValue}); no `prev` (the prev-tick lives on the tick ring,
 *   not on this event).
 * - Bar / Timer events carry neither axis.
 */
function extractPrevCurrent(event: EvaluationTriggerEvent): {
  prev: StateValue | null;
  current: StateValue | null;
} {
  if (
    event.kind === EvaluationTriggerKind.SymbolStateChanged ||
    event.kind === EvaluationTriggerKind.GlobalStateChanged ||
    event.kind === EvaluationTriggerKind.IndicatorChanged
  ) {
    return { prev: event.prev, current: event.current };
  }
  if (event.kind === EvaluationTriggerKind.Tick) {
    return {
      prev: null,
      current: { type: StateValueType.Number, value: event.price },
    };
  }
  return { prev: null, current: null };
}

/** Stringify a `StateValue` for template rendering; `null` → empty string. */
function stringifyStateValue(value: StateValue | null): string {
  return value === null ? '' : String(value.value);
}

/** Build an `Error` rule-event entry. */
function errorEntry(
  reason: string,
  ruleId: string,
  firingSymbolId: string,
  ts: number,
): RuleEventEntry {
  return {
    type: RuleEventType.Error,
    ts,
    ruleId,
    symbolId: firingSymbolId,
    reason,
  };
}
