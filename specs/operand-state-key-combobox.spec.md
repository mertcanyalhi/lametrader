# Spec: operand-state-key-combobox

- Status: implemented
- Touches: `packages/web/src/pages/rules/operand-picker.tsx`, `packages/web/src/pages/rules/leaf-editor.tsx`, `packages/web/src/pages/rules/condition-tree-editor.tsx`, `packages/web/src/pages/rules/rule-editor-dialog.tsx`.

## Goal

Give the rules editor's `IndicatorRef` operand a searchable **state-key combobox** driven by the indicator catalog's per-definition `state[].key` list, using the existing `StateKeyPicker` component so the operand picker's three reference kinds (`SymbolStateRef`, `GlobalStateRef`, `IndicatorRef`) all share one interaction pattern.
`SymbolStateRef` / `GlobalStateRef` already use `StateKeyPicker` — this spec extends the treatment to `IndicatorRef.stateKey` and to the plumbing that seeds its known-keys list from the indicator catalog.

## Acceptance criteria

- [x] `OperandPicker` accepts an optional `indicatorStateKeysByKey?: Record<string, string[]>` prop mapping each indicator definition `key` to its `state[].key` list.
- [x] When `value.kind === IndicatorRef` and the selected instance's `indicatorKey` is present in `indicatorStateKeysByKey`, the picker renders `StateKeyPicker` with those keys under `aria-label="Indicator state field"`.
- [x] When `value.kind === IndicatorRef` and no per-key entry exists (missing map, unknown `indicatorKey`, empty list), the picker still renders `StateKeyPicker` with an empty `knownKeys` so the freetext fallback stays available (matches the existing behavior for state refs when the catalog is empty).
- [x] `LeafEditor` and `ConditionTreeEditor` thread an optional `indicatorStateKeysByKey` prop through to every operand picker they render (LHS / RHS / upper / lower).
- [x] `RuleEditorDialog` derives `indicatorStateKeysByKey` from `useIndicatorCatalog()` and passes it to `ConditionTreeEditor`.

## End-to-end expectation

No new e2e; the flow is a UI refinement inside an already-wired editor and every acceptance criterion is verifiable at the picker unit-test level. The existing rules e2e continues to pass unmodified.

## Out of scope

- Changing `StateKeyPicker`'s public API or its rendering shape (dropdown + freetext).
- Restyling the empty-catalog case as pure freetext — the freetext input inside `StateKeyPicker` already acts as the fallback.
- A dedicated e2e — see above.

## Surprises

_None yet._
