# Spec: set-state-value-type-from-known-key

- Status: implemented
- Touches: `packages/web/src/pages/rules/actions-picker.tsx`, `packages/web/src/pages/rules/leaf-editor.tsx`, `packages/web/src/pages/rules/rule-editor-dialog.tsx`.

## Goal

Make the rule editor's `SetSymbolState` / `SetGlobalState` action row auto-adopt the state value's type when the user picks an already-persisted key, and hide the "Value type" dropdown in that case — the persisted type is authoritative, so re-declaring it is noise.
When the user creates a brand-new key (freetext entry through the combobox's create path), keep the "Value type" dropdown visible so the type gets chosen once, up front.

## Acceptance criteria

- [x] `KnownStateKeys` widens from `{ symbol: string[]; global: string[] }` to `{ symbol: Record<string, StateValue>; global: Record<string, StateValue> }` so the actions picker sees each known key's stored type without a second prop.
- [x] `SetSymbolState`: picking a known symbol-state key from the combobox updates `value.value` to the default of that key's persisted type (`Number → 0`, `Bool → false`, `String|Enum → ''`).
- [x] `SetGlobalState`: picking a known global-state key from the combobox updates `value.value` the same way.
- [x] When the current `key` matches a known key, the "Value type" dropdown is not rendered.
- [x] When the current `key` is empty or does not match any known key (fresh action, freetext-created key), the "Value type" dropdown is rendered and continues to drive `value.value.type` as it did before.

## End-to-end expectation

No new e2e; this is a per-row control-flow refinement inside an existing editor and every acceptance criterion is verifiable at the actions-picker unit-test level. The existing rules e2e continues to pass unmodified.

## Out of scope

- Extending the same auto-type behavior to the `SymbolStateRef` / `GlobalStateRef` operands on the LHS of a leaf. The user's bug report is about the SetState action's value input; the operand-side `valueType` is a separate concern (drives the operator picker + bool shortcut) and can be revisited if requested.
- Pre-populating the actual value with the persisted state's current value — the user's request only covered the type. Defaults to the type's neutral zero.
- Restyling / re-arranging the SetState row layout.

## Surprises

_None yet._
