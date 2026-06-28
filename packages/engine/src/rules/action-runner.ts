import {
  type Action,
  ActionKind,
  type FiredRuleEvent,
  type Notifier,
  type NotifyTelegramAction,
  type RemoveGlobalStateAction,
  type RemoveSymbolStateAction,
  type Rule,
  type RuleEvent,
  type RuleEventContext,
  type RuleEventEntry,
  type RuleEventLookupSnapshot,
  RuleEventType,
  type SetGlobalStateAction,
  type SetSymbolStateAction,
  type StateRepository,
  StateScope,
  type StateValue,
  UnknownDestinationError,
} from '@lametrader/core';

import type { EvaluationContext, EvaluationLookups } from './evaluation-context.types.js';

/**
 * The subset of {@link Action}s that mutate state — the input shape
 * {@link runStateAction} consumes.
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
 * Each per-action entry mirrors today's output:
 *   - `SetSymbolState` / `SetGlobalState`       → `StateSet` entry
 *   - `RemoveSymbolState` / `RemoveGlobalState` → `StateRemoved` entry
 *   - `NotifyTelegram` (success)                → `NotificationSent` entry
 *   - `NotifyTelegram` (template / destination / transport failure) → `Error` entry
 *
 * The trailing `Fired` umbrella entry includes the captured OHLCV snapshot
 * from `lookups` (#304).
 */
export class ActionRunner {
  constructor(
    private readonly state: StateRepository,
    private readonly notifier: Notifier,
    private readonly lookups: EvaluationLookups,
  ) {}

  /**
   * Execute every action on `rule` against `context`, returning the rule-event
   * entries for one complete fire — per-action entries followed by the
   * trailing `Fired` umbrella.
   */
  async run(
    rule: Rule,
    firingSymbolId: string,
    ts: number,
    context: EvaluationContext,
  ): Promise<RuleEventEntry[]> {
    const entries: RuleEventEntry[] = [];
    for (const action of rule.actions) {
      if (isStateAction(action)) {
        entries.push(await this.runStateAction(action, rule, firingSymbolId, ts));
        continue;
      }
      if (action.kind === ActionKind.NotifyTelegram) {
        entries.push(await this.runTelegramAction(action, rule.id, firingSymbolId, ts, context));
      }
    }
    const fired: FiredRuleEvent = {
      type: RuleEventType.Fired,
      ts,
      ruleId: rule.id,
      symbolId: firingSymbolId,
      context: captureContext(context.event, firingSymbolId, this.lookups),
    };
    entries.push(fired);
    return entries;
  }

  /**
   * Apply one state mutation through the {@link StateRepository} and produce
   * the matching `StateSet` / `StateRemoved` rule-event entry.
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
   * Render the template, send through the {@link Notifier}, and produce a
   * `NotificationSent` rule-event entry on success or an `Error` entry on
   * template / destination / transport failure.
   */
  private async runTelegramAction(
    action: NotifyTelegramAction,
    ruleId: string,
    firingSymbolId: string,
    ts: number,
    context: EvaluationContext,
  ): Promise<RuleEventEntry> {
    const render = renderTemplate(action.template, buildVars(context, firingSymbolId, ts));
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
}

/** Outcome of `renderTemplate` — either the rendered body or the first unknown token. */
type RenderResult = { ok: true; body: string } | { ok: false; unknownToken: string };

/** Variables available inside a notification template. */
type Vars = { symbolId: string; ts: string; prev: string; current: string };

/**
 * Snapshot the inbound event and the firing symbol's OHLCV lookups — the
 * "why did this fire here?" payload persisted alongside the
 * {@link FiredRuleEvent} entry (#304).
 */
function captureContext(
  inboundEvent: RuleEvent,
  firingSymbolId: string,
  lookups: EvaluationLookups,
): RuleEventContext {
  const lookupSnapshot: RuleEventLookupSnapshot = {
    current: lookups.getCurrentValue(firingSymbolId),
    open: lookups.getOpenValue(firingSymbolId),
    high: lookups.getHighValue(firingSymbolId),
    low: lookups.getLowValue(firingSymbolId),
    close: lookups.getCloseValue(firingSymbolId),
    volume: lookups.getVolumeValue(firingSymbolId),
  };
  return { inboundEvent, lookupSnapshot };
}

/**
 * Narrow `Action` to the state-mutation subset {@link runStateAction}
 * consumes.
 */
function isStateAction(action: Action): action is StateMutationAction {
  return (
    action.kind === ActionKind.SetSymbolState ||
    action.kind === ActionKind.SetGlobalState ||
    action.kind === ActionKind.RemoveSymbolState ||
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
 * Build the fixed allow-list of template variables from the context + the
 * caller's `firingSymbolId` / `ts`.
 */
function buildVars(context: EvaluationContext, firingSymbolId: string, ts: number): Vars {
  return {
    symbolId: firingSymbolId,
    ts: String(ts),
    prev: stringifyStateValue(context.prev),
    current: stringifyStateValue(context.current),
  };
}

/** Stringify a `StateValue` for inclusion in a template; `null` → empty string. */
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
