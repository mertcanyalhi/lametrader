# Spec: indicator-operand-state-schema-select

- Status: approved
- Touches: `packages/ui/src/pages/rules/operand-picker.tsx`, `packages/ui/src/pages/rules/leaf-editor.tsx`, `packages/ui/src/pages/rules/condition-tree-editor.tsx`, `packages/ui/src/pages/rules/rule-editor-dialog.tsx`.

## Goal

When picking an **Indicator** operand in the rule editor, the state-field input should be a closed `Select` driven by the selected indicator's declared `state` schema (`IndicatorDefinition.state: StateFieldDescriptor[]`), not a free-text combobox — state keys outside the schema never resolve at rule-eval time.
The operand's `valueType` is then derived from the picked descriptor's `FieldType` rather than hand-picked, and an enum-typed field constrains any RHS literal to the descriptor's closed `options`.

This supersedes the `IndicatorRef` half of `operand-state-key-combobox.spec.md` (the combobox was the open-set treatment; the indicator schema is a closed set, so it becomes a pure `Select`).

## Decision: `FieldType.Enum` maps to `StateValueType.String`

`StateValueType` is `{ String, Number, Bool }` — it has no `Enum` member, and enum state fields resolve to plain strings at eval time (`InferStateValue<EnumStateFieldDescriptor>` is `string | null`).
Adding a core `StateValueType.Enum` would ripple across the backend rule engine, domain validators, and every exhaustive switch — out of scope for this web-only change.
So the derived mapping is `FieldType.Number → StateValueType.Number` and `FieldType.Enum → StateValueType.String`, with the closed-set constraint enforced in the UI by an options-bound literal `Select` (labels shown, values submitted).

## Acceptance criteria

- [ ] `OperandPicker`'s per-indicator catalog prop carries full descriptors: `indicatorStateFieldsByKey?: Record<string, StateFieldDescriptor[]>` (keyed by `IndicatorDefinition.key`), replacing the `Record<string, string[]>` key-only shape.
- [ ] The `IndicatorRef` state-field input is a Radix `Select` (`aria-label="Indicator state field"`) whose options are the selected instance's indicator schema descriptors — each descriptor's `label` is shown and its `key` is the submitted value.
- [ ] Picking a state field sets both `stateKey` (the descriptor `key`) and `valueType`, derived from the descriptor's `type` (`FieldType.Number → StateValueType.Number`, `FieldType.Enum → StateValueType.String`).
- [ ] Switching the picked indicator instance re-scopes the state-field options and resets `stateKey`/`valueType` to the new indicator's first descriptor.
- [ ] When a Literal RHS operand is paired with an enum-typed `IndicatorRef` LHS, the literal editor renders a `Select` bound to the descriptor's `options` (`EnumOption.label` shown, `value` submitted) instead of a free-text input.

## End-to-end expectation

No new e2e — this is a UI refinement inside the already-wired rule editor, fully covered at the operand-picker unit-test level.
The existing rules e2e continues to pass unmodified.

## Out of scope

- Any `StateValueType.Enum` core member or backend rule-engine change (see the decision above).
- The `SymbolStateRef` / `GlobalStateRef` open-set comboboxes (issue #454) — they stay `StateKeyPicker`.
- Defaulting an enum RHS literal to the first option value — an empty value shows the `Select` placeholder and the user picks; the option-bound `Select` already prevents an out-of-set value.

## Surprises

_None yet._
</content>
</invoke>
