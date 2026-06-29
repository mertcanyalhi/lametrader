import {
  type Notifier,
  RulesV2,
  type StateRepository,
  StateScope,
  type StateValue,
  StateValueType,
  UnknownDestinationError,
} from '@lametrader/core';

import type { EvaluationLookups } from '../../rules/evaluation-context.types.js';

/**
 * The subset of v2 {@link RulesV2.Action}s that mutate state — the input
 * shape {@link ActionRunner.runStateAction} consumes.
 */
type StateMutationAction =
  | RulesV2.SetSymbolStateAction
  | RulesV2.RemoveSymbolStateAction
  | RulesV2.SetGlobalStateAction
  | RulesV2.RemoveGlobalStateAction;

/**
 * Application use-case that executes every action on one firing v2 rule and
 * returns the rule-event entries to commit.
 *
 * Per-action mutations (state writes, notifier sends) happen as side effects
 * during {@link run}. Event-log appends are NOT — the orchestrator commits
 * the returned list as one batch so "events emitted by one fire" have one
 * source of truth.
 *
 * Each per-action entry mirrors v1's vocabulary:
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
    rule: RulesV2.Rule,
    firingSymbolId: string,
    ts: number,
    event: RulesV2.EvaluationTriggerEvent,
  ): Promise<RulesV2.RuleEventEntry[]> {
    const entries: RulesV2.RuleEventEntry[] = [];
    for (const action of rule.actions) {
      if (isStateAction(action)) {
        entries.push(await this.runStateAction(action, rule, firingSymbolId, ts));
        continue;
      }
      entries.push(await this.runNotificationAction(action, rule.id, firingSymbolId, ts, event));
    }
    const fired: RulesV2.FiredRuleEvent = {
      type: RulesV2.RuleEventType.Fired,
      ts,
      ruleId: rule.id,
      symbolId: firingSymbolId,
      context: {
        inboundEvent: event,
        lookupSnapshot: this.snapshot(firingSymbolId),
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
    rule: RulesV2.Rule,
    firingSymbolId: string,
    ts: number,
  ): Promise<RulesV2.RuleEventEntry> {
    switch (action.kind) {
      case RulesV2.ActionKind.SetSymbolState:
        await this.state.setSymbolState(
          rule.profileId,
          firingSymbolId,
          action.key,
          action.value,
          ts,
        );
        return {
          type: RulesV2.RuleEventType.StateSet,
          ts,
          ruleId: rule.id,
          symbolId: firingSymbolId,
          scope: StateScope.Symbol,
          key: action.key,
          value: action.value,
        };
      case RulesV2.ActionKind.RemoveSymbolState:
        await this.state.removeSymbolState(rule.profileId, firingSymbolId, action.key, ts);
        return {
          type: RulesV2.RuleEventType.StateRemoved,
          ts,
          ruleId: rule.id,
          symbolId: firingSymbolId,
          scope: StateScope.Symbol,
          key: action.key,
        };
      case RulesV2.ActionKind.SetGlobalState:
        await this.state.setGlobalState(rule.profileId, action.key, action.value, ts);
        return {
          type: RulesV2.RuleEventType.StateSet,
          ts,
          ruleId: rule.id,
          symbolId: firingSymbolId,
          scope: StateScope.Global,
          key: action.key,
          value: action.value,
        };
      case RulesV2.ActionKind.RemoveGlobalState:
        await this.state.removeGlobalState(rule.profileId, action.key, ts);
        return {
          type: RulesV2.RuleEventType.StateRemoved,
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
   * Only the telegram channel ships at v2 launch (per ADR 0016 / #393); new
   * channels add new payload shapes under the same `Notification` kind.
   */
  private async runNotificationAction(
    action: RulesV2.NotificationAction,
    ruleId: string,
    firingSymbolId: string,
    ts: number,
    event: RulesV2.EvaluationTriggerEvent,
  ): Promise<RulesV2.RuleEventEntry> {
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
      type: RulesV2.RuleEventType.NotificationSent,
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
   */
  private snapshot(firingSymbolId: string): RulesV2.RuleEventLookupSnapshot {
    return {
      current: this.lookups.getCurrentValue(firingSymbolId),
      open: this.lookups.getOpenValue(firingSymbolId),
      high: this.lookups.getHighValue(firingSymbolId),
      low: this.lookups.getLowValue(firingSymbolId),
      close: this.lookups.getCloseValue(firingSymbolId),
      volume: this.lookups.getVolumeValue(firingSymbolId),
    };
  }
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

/** Narrow `RulesV2.Action` to the state-mutation subset. */
function isStateAction(action: RulesV2.Action): action is StateMutationAction {
  return (
    action.kind === RulesV2.ActionKind.SetSymbolState ||
    action.kind === RulesV2.ActionKind.RemoveSymbolState ||
    action.kind === RulesV2.ActionKind.SetGlobalState ||
    action.kind === RulesV2.ActionKind.RemoveGlobalState
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
function buildVars(
  event: RulesV2.EvaluationTriggerEvent,
  firingSymbolId: string,
  ts: number,
): Vars {
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
function extractPrevCurrent(event: RulesV2.EvaluationTriggerEvent): {
  prev: StateValue | null;
  current: StateValue | null;
} {
  if (
    event.kind === RulesV2.EvaluationTriggerKind.SymbolStateChanged ||
    event.kind === RulesV2.EvaluationTriggerKind.GlobalStateChanged ||
    event.kind === RulesV2.EvaluationTriggerKind.IndicatorChanged
  ) {
    return { prev: event.prev, current: event.current };
  }
  if (event.kind === RulesV2.EvaluationTriggerKind.Tick) {
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
): RulesV2.RuleEventEntry {
  return {
    type: RulesV2.RuleEventType.Error,
    ts,
    ruleId,
    symbolId: firingSymbolId,
    reason,
  };
}
