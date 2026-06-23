import {
  type ConditionNode,
  ConditionNodeKind,
  Period,
  RuleScopeKind,
  TriggerKind,
} from '@lametrader/core';
import * as yup from 'yup';

/** Default re-fire interval for `OncePerMinute` triggers — matches the engine. */
export const DEFAULT_TRIGGER_INTERVAL_MS = 60_000;

/**
 * Walk a condition tree and return `true` when every `And` / `Or` group has
 * at least one child (the editor lets users build an empty group, which the
 * domain rejects). Leaves are always valid here — their per-field validation
 * lands with the operand / operator pickers in #170–#171.
 */
export function isConditionTreeNonEmpty(node: ConditionNode): boolean {
  if (node.kind === ConditionNodeKind.Leaf) return true;
  if (node.children.length === 0) return false;
  return node.children.every(isConditionTreeNonEmpty);
}

/**
 * Human labels for the rule editor's basic fields — used as the form control
 * labels and (via Yup's `${label}` interpolation) inside validation messages,
 * so the label on the control matches the one in its error message.
 */
export const FIELD_LABELS = {
  name: 'Name',
  description: 'Description',
  scope: 'Scope',
  symbolId: 'Symbol',
  enabled: 'Enabled',
  condition: 'Condition',
  trigger: 'Trigger',
  triggerPeriod: 'Trigger period',
  triggerIntervalMs: 'Trigger interval (ms)',
} as const;

/**
 * The subset of a {@link Rule}'s mutable fields the editor's **basic** form
 * binds to. The condition tree, trigger, expiration, and actions surfaces
 * land in #169–#175 and will extend this shape.
 */
export interface RuleFormValues {
  /** Rule display name — required, trimmed. */
  name: string;
  /** Free-text description — may be empty. */
  description: string;
  /** Whether the rule selects one specific symbol or applies to every watched one. */
  scopeKind: RuleScopeKind;
  /**
   * The watched symbol id when `scopeKind === Symbol` — required in that case.
   * Empty when `scopeKind === AllSymbols`.
   */
  symbolId: string;
  /** Whether the rule is currently active. */
  enabled: boolean;
  /**
   * The rule's condition tree. Validated by {@link isConditionTreeNonEmpty}
   * to reject empty `And` / `Or` groups before the server round-trip.
   */
  condition: ConditionNode;
  /** Which trigger gate the rule uses — drives which sub-fields are required. */
  triggerKind: TriggerKind;
  /**
   * Bar size for the `OncePerBar` / `OncePerBarClose` triggers. Required by
   * the schema in those modes; ignored for `Once` / `OncePerMinute`.
   */
  triggerPeriod: Period | '';
  /**
   * Minimum re-fire interval in milliseconds for the `OncePerMinute` trigger.
   * Ignored for the other trigger kinds.
   */
  triggerIntervalMs: number;
}

/**
 * Yup schema for the rule editor's basic-fields form — the **user-facing**
 * validation layer. The server re-validates every write via the domain
 * validator (per ADR 0011), so this is a UX layer, not the source of truth.
 */
export const ruleFormSchema: yup.ObjectSchema<RuleFormValues> = yup.object({
  name: yup
    .string()
    .trim()
    .required(({ label }) => `${label} is required.`)
    .label(FIELD_LABELS.name),
  description: yup.string().defined().default('').label(FIELD_LABELS.description),
  scopeKind: yup
    .mixed<RuleScopeKind>()
    .oneOf(Object.values(RuleScopeKind))
    .required()
    .label(FIELD_LABELS.scope),
  symbolId: yup
    .string()
    .defined()
    .when('scopeKind', {
      is: RuleScopeKind.Symbol,
      // biome-ignore lint/suspicious/noThenProperty: `then` is Yup's `.when()` branch key, not a thenable.
      then: (schema) => schema.trim().required(({ label }) => `${label} is required.`),
      otherwise: (schema) => schema.default(''),
    })
    .label(FIELD_LABELS.symbolId),
  enabled: yup.boolean().required(),
  // The condition tree's shape is recursive and the leaf-level inputs land in
  // #170–#171; we accept any persisted node and check non-empty groups in the
  // submit handler via `isConditionTreeNonEmpty`.
  condition: yup.mixed<ConditionNode>().required().label(FIELD_LABELS.condition),
  triggerKind: yup
    .mixed<TriggerKind>()
    .oneOf(Object.values(TriggerKind))
    .required()
    .label(FIELD_LABELS.trigger),
  triggerPeriod: yup
    .mixed<Period | ''>()
    .oneOf(['' as const, ...Object.values(Period)])
    .defined()
    .test(
      'period-required-for-bar-triggers',
      ({ label }) => `${label} is required.`,
      function check(value) {
        const triggerKind = this.parent.triggerKind as TriggerKind;
        const barBased =
          triggerKind === TriggerKind.OncePerBar || triggerKind === TriggerKind.OncePerBarClose;
        if (!barBased) return true;
        return Object.values(Period).includes(value as Period);
      },
    )
    .label(FIELD_LABELS.triggerPeriod),
  triggerIntervalMs: yup
    .number()
    .typeError(({ label }) => `${label} must be a number.`)
    .integer()
    .min(1, ({ label }) => `${label} must be at least 1 ms.`)
    .required()
    .label(FIELD_LABELS.triggerIntervalMs),
});
