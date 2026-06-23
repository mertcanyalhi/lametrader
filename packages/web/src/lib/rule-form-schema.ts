import { RuleScopeKind } from '@lametrader/core';
import * as yup from 'yup';

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
});
