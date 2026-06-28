import {
  type Expiration,
  type Period,
  RULE_DESCRIPTION_MAX,
  RULE_NAME_MAX,
  RulesV2,
  SYMBOL_ID_MAX,
} from '@lametrader/core';
import * as yup from 'yup';

/**
 * Whether `action` writes (or removes) state — used by the actions editor to
 * branch the validation rules (state actions need a non-empty `key`,
 * notifications need destination + template).
 */
export function isStateActionV2(action: RulesV2.Action): boolean {
  return action.kind !== RulesV2.ActionKind.Notification;
}

/**
 * Walk a v2 condition tree and return `true` when every `And` / `Or` group has
 * at least one child. The editor lets users build empty groups, which the
 * domain rejects — this is the pre-submit guard so the dialog surfaces the
 * mistake inline instead of paying for a round-trip.
 */
export function isConditionTreeV2NonEmpty(node: RulesV2.ConditionNode): boolean {
  if (node.kind === RulesV2.ConditionNodeKind.Leaf) return true;
  if (node.children.length === 0) return false;
  return node.children.every(isConditionTreeV2NonEmpty);
}

/**
 * Human labels for the v2 rule editor's basic fields — used both as the form
 * control labels and (via Yup's `${label}` interpolation) inside validation
 * messages, so the label on the control matches the one in its error message.
 */
export const FIELD_LABELS_V2 = {
  name: 'Name',
  description: 'Description',
  scope: 'Scope',
  symbolId: 'Symbol',
  symbolIds: 'Symbols',
  enabled: 'Enabled',
  condition: 'Condition',
  trigger: 'Trigger',
  triggerPeriod: 'Trigger period',
  triggerIntervalMs: 'Trigger interval (ms)',
  expiration: 'Expiration',
  expirationAt: 'Expiration date',
  actions: 'Actions',
} as const;

/** The two expiration modes the v2 form exposes (same shape as v1). */
export enum ExpirationKindV2 {
  /** Rule never expires; persists as `null`. */
  Never = 'never',
  /** Rule expires at a specific date; persists as `{ at: <epoch ms> }`. */
  OnDate = 'date',
}

/**
 * The mutable subset of a v2 {@link RulesV2.Rule} the editor's form binds to.
 *
 * Mirrors v1's `RuleFormValues` shape, adapted for the v2 type surface:
 * `scopeKind` covers all three v2 scope variants, the trigger fields cover the
 * six v2 trigger kinds, and the condition tree is stored as the canonical
 * recursive v2 shape (the condition-tree editor owns its mutations).
 */
export interface RuleV2FormValues {
  /** Rule display name — required, trimmed. */
  name: string;
  /** Free-text description — may be empty. */
  description: string;
  /** Which v2 scope kind the rule uses — Symbol / Symbols / AllSymbols. */
  scopeKind: RulesV2.RuleScopeKind;
  /** Required when `scopeKind === Symbol`; empty otherwise. */
  symbolId: string;
  /** Required (`length >= 1`) when `scopeKind === Symbols`; empty otherwise. */
  symbolIds: string[];
  /** Whether the rule is currently active. */
  enabled: boolean;
  /** The rule's full v2 condition tree, validated by {@link isConditionTreeV2NonEmpty}. */
  condition: RulesV2.ConditionNode;
  /** Which trigger kind drives evaluation; gates the sub-fields below. */
  triggerKind: RulesV2.TriggerKind;
  /**
   * Bar `period` for `OncePerBar` / `OncePerBarOpen` / `OncePerBarClose`.
   * Required by the schema in those modes; ignored for the others.
   */
  triggerPeriod: Period | '';
  /**
   * Wall-clock interval (ms) for `OncePerInterval`. Ignored for the other
   * trigger kinds.
   */
  triggerIntervalMs: number;
  /** Whether the rule expires — `Never` or `OnDate`. */
  expirationKind: ExpirationKindV2;
  /**
   * `datetime-local`-formatted expiration timestamp (`YYYY-MM-DDTHH:mm`) when
   * `expirationKind === OnDate`; empty string when `Never`.
   */
  expirationAt: string;
  /** Side-effects the rule runs on fire; at least one required. */
  actions: RulesV2.Action[];
}

/** The trigger kinds whose schema requires a `period`. Single source of truth. */
const BAR_BASED_TRIGGER_KINDS_V2: ReadonlySet<RulesV2.TriggerKind> = new Set([
  RulesV2.TriggerKind.OncePerBar,
  RulesV2.TriggerKind.OncePerBarOpen,
  RulesV2.TriggerKind.OncePerBarClose,
]);

/** Whether the given v2 trigger kind requires a `period` sub-field. */
export function isBarBasedTriggerV2(kind: RulesV2.TriggerKind): boolean {
  return BAR_BASED_TRIGGER_KINDS_V2.has(kind);
}

/** Default re-fire interval for `OncePerInterval` — one minute. */
export const DEFAULT_TRIGGER_INTERVAL_MS_V2 = 60_000;

/**
 * Yup schema for the v2 rule editor's form. UI-layer validation only — the
 * server re-validates every write via the v2 boundary schema + domain
 * validator, which is the authority (per ADR 0011).
 */
export const ruleV2FormSchema: yup.ObjectSchema<RuleV2FormValues> = yup.object({
  name: yup
    .string()
    .trim()
    .required(({ label }) => `${label} is required.`)
    .max(RULE_NAME_MAX, ({ label, max }) => `${label} must be ${max} characters or fewer.`)
    .label(FIELD_LABELS_V2.name),
  description: yup
    .string()
    .defined()
    .default('')
    .max(RULE_DESCRIPTION_MAX, ({ label, max }) => `${label} must be ${max} characters or fewer.`)
    .label(FIELD_LABELS_V2.description),
  scopeKind: yup
    .mixed<RulesV2.RuleScopeKind>()
    .oneOf(Object.values(RulesV2.RuleScopeKind))
    .required()
    .label(FIELD_LABELS_V2.scope),
  symbolId: yup
    .string()
    .defined()
    .when('scopeKind', {
      is: RulesV2.RuleScopeKind.Symbol,
      // biome-ignore lint/suspicious/noThenProperty: `then` is Yup's `.when()` branch key, not a thenable.
      then: (schema) =>
        schema
          .trim()
          .required(({ label }) => `${label} is required.`)
          .max(SYMBOL_ID_MAX, ({ label, max }) => `${label} must be ${max} characters or fewer.`),
      otherwise: (schema) => schema.default(''),
    })
    .label(FIELD_LABELS_V2.symbolId),
  symbolIds: yup
    .array(yup.string().required())
    .defined()
    .default([])
    .when('scopeKind', {
      is: RulesV2.RuleScopeKind.Symbols,
      // biome-ignore lint/suspicious/noThenProperty: `then` is Yup's `.when()` branch key, not a thenable.
      then: (schema) =>
        schema
          .min(1, ({ label }) => `${label} require at least one symbol.`)
          .test('symbols-distinct', 'Pick each symbol at most once.', (value) => {
            const list = (value ?? []) as string[];
            return new Set(list).size === list.length;
          }),
      otherwise: (schema) => schema,
    })
    .label(FIELD_LABELS_V2.symbolIds),
  enabled: yup.boolean().required(),
  condition: yup.mixed<RulesV2.ConditionNode>().required().label(FIELD_LABELS_V2.condition),
  triggerKind: yup
    .mixed<RulesV2.TriggerKind>()
    .oneOf(Object.values(RulesV2.TriggerKind))
    .required()
    .label(FIELD_LABELS_V2.trigger),
  triggerPeriod: yup
    .mixed<Period | ''>()
    .defined()
    .test(
      'period-required-for-bar-triggers',
      ({ label }) => `${label} is required.`,
      function check(value) {
        const kind = this.parent.triggerKind as RulesV2.TriggerKind;
        if (!isBarBasedTriggerV2(kind)) return true;
        return value !== undefined && value !== '';
      },
    )
    .label(FIELD_LABELS_V2.triggerPeriod),
  triggerIntervalMs: yup
    .number()
    .typeError(({ label }) => `${label} must be a number.`)
    .integer()
    .min(1, ({ label }) => `${label} must be at least 1 ms.`)
    .required()
    .label(FIELD_LABELS_V2.triggerIntervalMs),
  expirationKind: yup
    .mixed<ExpirationKindV2>()
    .oneOf(Object.values(ExpirationKindV2))
    .required()
    .label(FIELD_LABELS_V2.expiration),
  expirationAt: yup
    .string()
    .defined()
    .default('')
    .test(
      'expiration-date-required-and-future',
      ({ label }) => `${label} must be in the future.`,
      function check(value) {
        const kind = this.parent.expirationKind as ExpirationKindV2;
        if (kind !== ExpirationKindV2.OnDate) return true;
        const parsed = Date.parse(String(value ?? ''));
        return Number.isFinite(parsed) && parsed > Date.now();
      },
    )
    .label(FIELD_LABELS_V2.expirationAt),
  actions: yup
    .mixed<RulesV2.Action[]>()
    .required()
    .test(
      'actions-min-one',
      ({ label }) => `${label} require at least one entry.`,
      (value) => Array.isArray(value) && value.length >= 1,
    )
    .test('state-action-keys-required', 'Every state action needs a non-empty key.', (value) => {
      if (!Array.isArray(value)) return true;
      return value.every(
        (action: RulesV2.Action) =>
          !isStateActionV2(action) ||
          (typeof (action as { key: string }).key === 'string' &&
            (action as { key: string }).key.trim() !== ''),
      );
    })
    .label(FIELD_LABELS_V2.actions),
});

/**
 * Build a v2 domain {@link RulesV2.Trigger} from the flat trigger form values.
 *
 * Validation has already rejected `triggerPeriod === ''` for bar-based kinds
 * by the time this runs.
 */
export function triggerV2FromForm(values: {
  triggerKind: RulesV2.TriggerKind;
  triggerPeriod: Period | '';
  triggerIntervalMs: number;
}): RulesV2.Trigger {
  switch (values.triggerKind) {
    case RulesV2.TriggerKind.EveryTime:
      return { kind: RulesV2.TriggerKind.EveryTime };
    case RulesV2.TriggerKind.Once:
      return { kind: RulesV2.TriggerKind.Once };
    case RulesV2.TriggerKind.OncePerBar:
      return { kind: RulesV2.TriggerKind.OncePerBar, period: values.triggerPeriod as Period };
    case RulesV2.TriggerKind.OncePerBarOpen:
      return { kind: RulesV2.TriggerKind.OncePerBarOpen, period: values.triggerPeriod as Period };
    case RulesV2.TriggerKind.OncePerBarClose:
      return { kind: RulesV2.TriggerKind.OncePerBarClose, period: values.triggerPeriod as Period };
    case RulesV2.TriggerKind.OncePerInterval:
      return { kind: RulesV2.TriggerKind.OncePerInterval, intervalMs: values.triggerIntervalMs };
  }
}

/** Project a v2 domain {@link RulesV2.Trigger} into the flat form-value shape. */
export function triggerV2ToForm(trigger: RulesV2.Trigger): {
  triggerKind: RulesV2.TriggerKind;
  triggerPeriod: Period | '';
  triggerIntervalMs: number;
} {
  const triggerPeriod: Period | '' =
    trigger.kind === RulesV2.TriggerKind.OncePerBar ||
    trigger.kind === RulesV2.TriggerKind.OncePerBarOpen ||
    trigger.kind === RulesV2.TriggerKind.OncePerBarClose
      ? trigger.period
      : '';
  const triggerIntervalMs =
    trigger.kind === RulesV2.TriggerKind.OncePerInterval
      ? trigger.intervalMs
      : DEFAULT_TRIGGER_INTERVAL_MS_V2;
  return { triggerKind: trigger.kind, triggerPeriod, triggerIntervalMs };
}

/** Build the v2 scope object from the flat scope form fields. */
export function scopeV2FromForm(values: {
  scopeKind: RulesV2.RuleScopeKind;
  symbolId: string;
  symbolIds: string[];
}): RulesV2.RuleScope {
  switch (values.scopeKind) {
    case RulesV2.RuleScopeKind.Symbol:
      return { kind: RulesV2.RuleScopeKind.Symbol, symbolId: values.symbolId };
    case RulesV2.RuleScopeKind.Symbols:
      return { kind: RulesV2.RuleScopeKind.Symbols, symbolIds: values.symbolIds };
    case RulesV2.RuleScopeKind.AllSymbols:
      return { kind: RulesV2.RuleScopeKind.AllSymbols };
  }
}

/** Build the flat scope form fields from a v2 {@link RulesV2.RuleScope}. */
export function scopeV2ToForm(scope: RulesV2.RuleScope): {
  scopeKind: RulesV2.RuleScopeKind;
  symbolId: string;
  symbolIds: string[];
} {
  switch (scope.kind) {
    case RulesV2.RuleScopeKind.Symbol:
      return {
        scopeKind: RulesV2.RuleScopeKind.Symbol,
        symbolId: scope.symbolId,
        symbolIds: [],
      };
    case RulesV2.RuleScopeKind.Symbols:
      return {
        scopeKind: RulesV2.RuleScopeKind.Symbols,
        symbolId: '',
        symbolIds: scope.symbolIds,
      };
    case RulesV2.RuleScopeKind.AllSymbols:
      return {
        scopeKind: RulesV2.RuleScopeKind.AllSymbols,
        symbolId: '',
        symbolIds: [],
      };
  }
}

/** Build a v2 {@link Expiration} from the flat expiration form fields. */
export function expirationV2FromForm(values: {
  expirationKind: ExpirationKindV2;
  expirationAt: string;
}): Expiration {
  if (values.expirationKind === ExpirationKindV2.Never) return null;
  return { at: Date.parse(values.expirationAt) };
}
