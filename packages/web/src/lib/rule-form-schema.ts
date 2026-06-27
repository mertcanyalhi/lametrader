import {
  type Action,
  ActionKind,
  type ConditionNode,
  ConditionNodeKind,
  Period,
  RULE_DESCRIPTION_MAX,
  RULE_NAME_MAX,
  RuleScopeKind,
  SYMBOL_ID_MAX,
  TriggerKind,
} from '@lametrader/core';
import * as yup from 'yup';

/** Whether `action` writes (or removes) state — what the actions editor edits. */
export function isStateAction(action: Action): boolean {
  return action.kind !== ActionKind.NotifyTelegram;
}

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
  expiration: 'Expiration',
  expirationAt: 'Expiration date',
  actions: 'Actions',
} as const;

/** The two expiration modes the form exposes. */
export enum ExpirationKind {
  /** Rule never expires; persists as `null`. */
  Never = 'never',
  /** Rule expires at a specific date; persists as `{ at: <epoch ms> }`. */
  OnDate = 'date',
}

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
  /** Which expiration mode the rule uses — `Never` or `OnDate`. */
  expirationKind: ExpirationKind;
  /**
   * `datetime-local`-formatted expiration timestamp (`YYYY-MM-DDTHH:mm`) when
   * `expirationKind === OnDate`. The schema enforces "in the future"; empty
   * string when the mode is `Never`.
   */
  expirationAt: string;
  /**
   * The full action list the rule will execute on fire. The editor surface
   * (#174 / #175) renders one input row per action.
   */
  actions: Action[];
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
    .max(RULE_NAME_MAX, ({ label, max }) => `${label} must be ${max} characters or fewer.`)
    .label(FIELD_LABELS.name),
  description: yup
    .string()
    .defined()
    .default('')
    .max(RULE_DESCRIPTION_MAX, ({ label, max }) => `${label} must be ${max} characters or fewer.`)
    .label(FIELD_LABELS.description),
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
      then: (schema) =>
        schema
          .trim()
          .required(({ label }) => `${label} is required.`)
          .max(SYMBOL_ID_MAX, ({ label, max }) => `${label} must be ${max} characters or fewer.`),
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
  expirationKind: yup
    .mixed<ExpirationKind>()
    .oneOf(Object.values(ExpirationKind))
    .required()
    .label(FIELD_LABELS.expiration),
  expirationAt: yup
    .string()
    .defined()
    .default('')
    .test(
      'expiration-date-required-and-future',
      ({ label }) => `${label} must be in the future.`,
      function check(value) {
        const kind = this.parent.expirationKind as ExpirationKind;
        if (kind !== ExpirationKind.OnDate) return true;
        const parsed = Date.parse(String(value ?? ''));
        return Number.isFinite(parsed) && parsed > Date.now();
      },
    )
    .label(FIELD_LABELS.expirationAt),
  actions: yup
    .mixed<Action[]>()
    .required()
    .test(
      'actions-min-one',
      ({ label }) => `${label} require at least one entry.`,
      (value) => Array.isArray(value) && value.length >= 1,
    )
    .test('state-action-keys-required', 'Every state action needs a non-empty key.', (value) => {
      if (!Array.isArray(value)) return true;
      return value.every(
        (action: Action) =>
          !isStateAction(action) ||
          (typeof (action as { key: string }).key === 'string' &&
            (action as { key: string }).key.trim() !== ''),
      );
    })
    .label(FIELD_LABELS.actions),
});
