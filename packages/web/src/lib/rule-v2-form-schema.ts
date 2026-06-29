import { RULE_DESCRIPTION_MAX, RULE_NAME_MAX, RulesV2, StateValueType } from '@lametrader/core';
import * as yup from 'yup';

/**
 * Human labels for the rule editor's basic fields — used as the form control
 * labels and (via Yup's `${label}` interpolation) inside validation messages,
 * so the label on the control matches the one in its error message.
 */
export const FIELD_LABELS_V2 = {
  name: 'Name',
  description: 'Description',
  scope: 'Scope',
  scopeSymbol: 'Symbol',
  scopeSymbols: 'Symbols',
  enabled: 'Enabled',
  condition: 'Condition',
  trigger: 'Trigger',
  triggerPeriod: 'Trigger period',
  triggerIntervalMs: 'Trigger interval (ms)',
  actions: 'Actions',
} as const;

/**
 * The subset of a v2 {@link RulesV2.Rule}'s mutable fields the editor's
 * top-level form binds to.
 *
 * Condition tree, trigger, scope, and actions are managed by dedicated picker
 * components, but the form holds their current values so submit can assemble
 * the full payload.
 */
export interface RuleV2FormValues {
  /** Rule display name — required, trimmed. */
  name: string;
  /** Free-text description — may be empty. */
  description: string;
  /** Which symbol(s) the rule applies to. */
  scope: RulesV2.RuleScope;
  /** Which evaluation cadence drives the rule and how often it may re-fire. */
  trigger: RulesV2.Trigger;
  /** The condition tree evaluated each cadence tick. */
  condition: RulesV2.ConditionNode;
  /** Side-effects performed on fire (non-empty). */
  actions: RulesV2.Action[];
  /** Whether the rule is currently active. */
  enabled: boolean;
}

/**
 * Walk a v2 condition tree and return `true` when every `And` / `Or` group has
 * at least one child (the editor lets users build an empty group, which the
 * domain rejects).
 *
 * Leaves are always valid here — per-field validation lives on each picker.
 */
export function isConditionTreeV2NonEmpty(node: RulesV2.ConditionNode): boolean {
  if (node.kind === RulesV2.ConditionNodeKind.Leaf) return true;
  if (node.children.length === 0) return false;
  return node.children.every(isConditionTreeV2NonEmpty);
}

/**
 * The categories of LHS value type the operator picker filters by.
 *
 * `Unknown` covers operands whose type can't be resolved yet (a fresh
 * `Literal` before the user picks a kind, an `IndicatorRef` with no instance
 * chosen) — every operator is allowed in that state until enough info exists
 * to narrow.
 */
export enum OperandValueKind {
  /** Numeric LHS — comparison / crossing / channel / moving + state are legal. */
  Numeric = 'numeric',
  /** Bool LHS — only state operators are legal; the editor short-cuts to single-operand sugar. */
  Bool = 'bool',
  /** String / enum LHS — only state operators are legal (equality, transition). */
  StringLike = 'stringLike',
  /** Couldn't resolve a type for this operand yet. */
  Unknown = 'unknown',
}

/**
 * Resolve a v2 {@link RulesV2.ConditionOperand} to its {@link OperandValueKind}
 * — the category the operator picker filters by.
 *
 * `Price` / `Open` / `High` / `Low` / `Close` / `Volume` are always numeric.
 * `IndicatorRef` / `SymbolStateRef` / `GlobalStateRef` carry their `valueType`.
 * `Literal` carries its `value.type`.
 */
export function operandValueKind(operand: RulesV2.ConditionOperand): OperandValueKind {
  switch (operand.kind) {
    case RulesV2.OperandKind.Price:
    case RulesV2.OperandKind.Open:
    case RulesV2.OperandKind.High:
    case RulesV2.OperandKind.Low:
    case RulesV2.OperandKind.Close:
    case RulesV2.OperandKind.Volume:
      return OperandValueKind.Numeric;
    case RulesV2.OperandKind.IndicatorRef:
    case RulesV2.OperandKind.SymbolStateRef:
    case RulesV2.OperandKind.GlobalStateRef:
      return valueTypeKind(operand.valueType);
    case RulesV2.OperandKind.Literal:
      return valueTypeKind(operand.value.type);
  }
}

/**
 * Map a {@link StateValueType} (carried on indicator/state/literal operands) to
 * the operator-picker category.
 */
export function valueTypeKind(valueType: StateValueType): OperandValueKind {
  switch (valueType) {
    case StateValueType.Number:
      return OperandValueKind.Numeric;
    case StateValueType.Bool:
      return OperandValueKind.Bool;
    case StateValueType.String:
    case StateValueType.Enum:
      return OperandValueKind.StringLike;
  }
}

/**
 * Whether an operand carries a `valueType` that should drive a bool-shortcut
 * row layout (operator + RHS hidden, saved leaf is `Equals(operand, true)`).
 *
 * `Literal` carries its own value and isn't a candidate for the shortcut.
 */
export function isBoolOperand(operand: RulesV2.ConditionOperand): boolean {
  if (operand.kind === RulesV2.OperandKind.IndicatorRef)
    return operand.valueType === StateValueType.Bool;
  if (operand.kind === RulesV2.OperandKind.SymbolStateRef)
    return operand.valueType === StateValueType.Bool;
  if (operand.kind === RulesV2.OperandKind.GlobalStateRef)
    return operand.valueType === StateValueType.Bool;
  return false;
}

/**
 * Yup schema for the rule editor's basic-fields form — the **user-facing**
 * validation layer. The server re-validates every write via the v2 schema
 * validator (per ADR 0016 / ADR 0011), so this is the UX layer, not the source
 * of truth.
 *
 * The richer per-picker concerns (operand kinds, operator families, interval
 * presence) are validated structurally by their pickers; this schema only
 * checks the bits a Yup string/array constraint expresses cleanly.
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
  scope: yup
    .mixed<RulesV2.RuleScope>()
    .required()
    .test('scope-symbol-required', 'Scope is missing a symbol selection.', (value) => {
      if (!value) return false;
      if (value.kind === RulesV2.RuleScopeKind.Symbol) return value.symbolId.trim() !== '';
      if (value.kind === RulesV2.RuleScopeKind.Symbols) return value.symbolIds.length > 0;
      return true;
    })
    .label(FIELD_LABELS_V2.scope),
  trigger: yup
    .mixed<RulesV2.Trigger>()
    .required()
    .test(
      'trigger-fields-present',
      'Trigger is missing a required period or interval.',
      (value) => {
        if (!value) return false;
        switch (value.kind) {
          case RulesV2.TriggerKind.EveryTime:
          case RulesV2.TriggerKind.Once:
            return true;
          case RulesV2.TriggerKind.OncePerBar:
          case RulesV2.TriggerKind.OncePerBarOpen:
          case RulesV2.TriggerKind.OncePerBarClose:
            return typeof value.period === 'string' && value.period.length > 0;
          case RulesV2.TriggerKind.OncePerInterval:
            return Number.isFinite(value.intervalMs) && value.intervalMs > 0;
        }
      },
    )
    .label(FIELD_LABELS_V2.trigger),
  condition: yup
    .mixed<RulesV2.ConditionNode>()
    .required()
    .test('condition-non-empty', 'Every AND / OR group must have at least one child.', (value) => {
      if (!value) return false;
      return isConditionTreeV2NonEmpty(value);
    })
    .label(FIELD_LABELS_V2.condition),
  actions: yup
    .mixed<RulesV2.Action[]>()
    .required()
    .test(
      'actions-min-one',
      ({ label }) => `${label} require at least one entry.`,
      (value) => Array.isArray(value) && value.length >= 1,
    )
    .label(FIELD_LABELS_V2.actions),
  enabled: yup.boolean().required(),
});
