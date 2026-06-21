import {
  type EventLog,
  type Notifier,
  type NotifyTelegramAction,
  RuleEventType,
  type StateValue,
  UnknownDestinationError,
} from '@lametrader/core';
import type { EvaluationContext } from './evaluation-context.types.js';

/** Outcome of `renderTemplate` — either the rendered body or the first unknown token. */
type RenderResult = { ok: true; body: string } | { ok: false; unknownToken: string };

/** Variables available inside a notification template. */
type Vars = { symbolId: string; ts: string; prev: string; current: string };

/**
 * Execute one `NotifyTelegram` action.
 *
 * Renders the action's template against the {@link EvaluationContext}'s fixed
 * allow-list (`{symbolId}`, `{ts}`, `{prev}`, `{current}`), calls the
 * {@link Notifier} with the resolved body, and appends one event entry to
 * both the rule and symbol logs:
 *
 * - Successful send → `NotificationSent` event.
 * - Unknown template token → `Error` event (notifier not called).
 * - Unknown destination → `Error` event.
 * - Transport failure → `Error` event.
 */
export async function executeTelegramAction(
  action: NotifyTelegramAction,
  context: EvaluationContext,
  ruleId: string,
  firingSymbolId: string,
  ts: number,
  notifier: Notifier,
  log: EventLog,
): Promise<void> {
  const render = renderTemplate(action.template, buildVars(context, firingSymbolId, ts));
  if (!render.ok) {
    await appendError(
      `unknown template token: {${render.unknownToken}}`,
      ruleId,
      firingSymbolId,
      ts,
      log,
    );
    return;
  }
  try {
    await notifier.send(action.destinationName, render.body);
  } catch (error) {
    const reason =
      error instanceof UnknownDestinationError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    await appendError(reason, ruleId, firingSymbolId, ts, log);
    return;
  }
  const entry = {
    type: RuleEventType.NotificationSent as const,
    ts,
    ruleId,
    symbolId: firingSymbolId,
    destinationName: action.destinationName,
    body: render.body,
  };
  await log.appendRuleEvent(ruleId, entry);
  await log.appendSymbolEvent(firingSymbolId, entry);
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

/**
 * Stringify a `StateValue` for inclusion in a template; `null` → empty
 * string.
 */
function stringifyStateValue(value: StateValue | null): string {
  return value === null ? '' : String(value.value);
}

/**
 * Append one `Error` event to both the rule and symbol logs.
 */
async function appendError(
  reason: string,
  ruleId: string,
  firingSymbolId: string,
  ts: number,
  log: EventLog,
): Promise<void> {
  const entry = {
    type: RuleEventType.Error as const,
    ts,
    ruleId,
    symbolId: firingSymbolId,
    reason,
  };
  await log.appendRuleEvent(ruleId, entry);
  await log.appendSymbolEvent(firingSymbolId, entry);
}
