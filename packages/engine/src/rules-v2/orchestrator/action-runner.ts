import {
  type Notifier,
  type Period,
  RulesV2,
  type StateRepository,
  StateScope,
  UnknownDestinationError,
} from '@lametrader/core';

import { BarAxis } from '../bar-series.js';
import type { EvaluationContext, EvaluationLookups } from '../evaluation-context.types.js';

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
 * Per-fire input the orchestrator hands the {@link ActionRunner.run} — the
 * rule, firing symbol, source `ts`, evaluation context (for template
 * resolution), and the snapshot period used to capture the OHLCV lookup
 * snapshot on the `Fired` umbrella entry.
 */
export interface RunActionsInput {
  /** The rule whose actions to execute. */
  rule: RulesV2.Rule;
  /** Which symbol the fire is attributed to. */
  firingSymbolId: string;
  /** Source timestamp (epoch ms) — the inbound event's `ts`. */
  ts: number;
  /** Evaluation context built for this fire — used by template resolution. */
  context: EvaluationContext;
  /**
   * Bar period the OHLCV lookup snapshot reads at — typically the trigger's
   * period (for bar-cadence triggers) or the orchestrator's `defaultPeriod`
   * (for tick/cascade events).
   */
  snapshotPeriod: Period;
}

/**
 * Application use-case that executes every action on one firing v2 rule and
 * returns the {@link RulesV2.RuleEventEntry}s to commit.
 *
 * Per-action mutations (state writes, notifier sends) happen as side effects
 * during {@link run}. Event-log appends are NOT — the orchestrator commits
 * the returned list as one batch so "events emitted by one fire" have one
 * source of truth.
 *
 * Each per-action entry:
 *   - `SetSymbolState` / `SetGlobalState`       → `StateSet` entry
 *   - `RemoveSymbolState` / `RemoveGlobalState` → `StateRemoved` entry
 *   - `Notification` (success)                  → `NotificationSent` entry
 *   - `Notification` (template / destination / transport failure) → `Error` entry
 *
 * The trailing `Fired` umbrella entry captures the inbound event + the firing
 * symbol's OHLCV lookup snapshot (forensic "why did this fire here?" payload).
 */
export class ActionRunner {
  constructor(
    private readonly state: StateRepository,
    private readonly notifier: Notifier,
    private readonly lookups: EvaluationLookups,
  ) {}

  /**
   * Execute every action on `input.rule` against `input.context`, returning
   * the rule-event entries for one complete fire — per-action entries
   * followed by the trailing `Fired` umbrella.
   */
  async run(input: RunActionsInput): Promise<RulesV2.RuleEventEntry[]> {
    const { rule, firingSymbolId, ts, context, snapshotPeriod } = input;
    const entries: RulesV2.RuleEventEntry[] = [];
    for (const action of rule.actions) {
      if (isStateAction(action)) {
        entries.push(await this.runStateAction(action, rule, firingSymbolId, ts));
        continue;
      }
      if (action.kind === RulesV2.ActionKind.Notification) {
        entries.push(await this.runNotificationAction(action, rule.id, firingSymbolId, ts));
      }
    }
    const fired: RulesV2.FiredRuleEvent = {
      type: RulesV2.RuleEventType.Fired,
      ts,
      ruleId: rule.id,
      symbolId: firingSymbolId,
      context: {
        inboundEvent: context.event,
        lookupSnapshot: captureLookupSnapshot(this.lookups, firingSymbolId, snapshotPeriod),
      },
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
   * Render the template, send through the {@link Notifier}, and produce a
   * `NotificationSent` rule-event entry on success or an `Error` entry on
   * template / destination / transport failure.
   */
  private async runNotificationAction(
    action: RulesV2.NotificationAction,
    ruleId: string,
    firingSymbolId: string,
    ts: number,
  ): Promise<RulesV2.RuleEventEntry> {
    const render = renderTemplate(action.template, buildVars(firingSymbolId, ts));
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
}

/** Outcome of `renderTemplate` — either the rendered body or the first unknown token. */
type RenderResult = { ok: true; body: string } | { ok: false; unknownToken: string };

/** Variables available inside a notification template. */
type Vars = { symbolId: string; ts: string };

/**
 * Snapshot the firing symbol's last-tick + bar OHLCV values at fire-time. The
 * snapshot is read once via the lookups; `null` slots indicate the underlying
 * lookup had no value yet for the firing symbol at this period.
 */
function captureLookupSnapshot(
  lookups: EvaluationLookups,
  firingSymbolId: string,
  period: Period,
): RulesV2.RuleEventLookupSnapshot {
  return {
    current: lookups.latestPrice(firingSymbolId),
    open: lookups.latestOhlcv(firingSymbolId, period, BarAxis.Open),
    high: lookups.latestOhlcv(firingSymbolId, period, BarAxis.High),
    low: lookups.latestOhlcv(firingSymbolId, period, BarAxis.Low),
    close: lookups.latestOhlcv(firingSymbolId, period, BarAxis.Close),
    volume: lookups.latestOhlcv(firingSymbolId, period, BarAxis.Volume),
  };
}

/**
 * Narrow `Action` to the state-mutation subset {@link ActionRunner.runStateAction}
 * consumes.
 */
function isStateAction(action: RulesV2.Action): action is StateMutationAction {
  return (
    action.kind === RulesV2.ActionKind.SetSymbolState ||
    action.kind === RulesV2.ActionKind.SetGlobalState ||
    action.kind === RulesV2.ActionKind.RemoveSymbolState ||
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
 * Build the fixed allow-list of template variables. v2 keeps the surface
 * narrow at launch (symbolId + ts); the v1 `prev` / `current` template vars
 * (which were drawn from the v1 single-axis evaluation context) don't have a
 * direct analogue under v2's series-aware operand model, so they're omitted
 * until a concrete need surfaces.
 */
function buildVars(firingSymbolId: string, ts: number): Vars {
  return { symbolId: firingSymbolId, ts: String(ts) };
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
