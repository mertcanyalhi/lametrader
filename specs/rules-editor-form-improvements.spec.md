# rules-editor-form-improvements

UI-only improvements to the rule editor (`packages/web/src/pages/rules/*`).
Eight independent gaps bundled because they touch the same form surface and share design overlap; see #428.

## Acceptance criteria

- [ ] Scope > One symbol picker shows a visible filter input above the option list and scrolls when there are more rows than fit.
- [ ] Scope > Specific symbols picker shows a filter input above the checkbox stack and scrolls; multi-select continues to work.
- [ ] The Trigger label carries an `Info` icon and a Radix `<Tooltip>` whose content lists each `TriggerKind` and its explanation.
- [ ] The action editor's `SetState` / `RemoveState` rows reuse the `StateKeyPicker` combobox pattern (known keys dropdown + freetext fallback) instead of a plain `<TextField>`.
- [ ] The operator picker groups options by `LeafConditionFamily` (Comparison / Crossing / Channel / Moving / State) via `Select.Group` + `Select.Label`, in that engine order.
- [ ] Each operator option in the picker renders a `lucide-react` icon next to its label.
- [ ] When the rule scope is `Symbols(list)`, the indicator operand picker filters the profile's indicator instances to those whose profile scope covers ALL of the rule's selected symbol ids; `AllSymbols` and `Symbol` scopes pass every profile indicator through.
- [ ] When the LHS is `SymbolStateRef` / `GlobalStateRef` with the `Equals` operator, the RHS `Literal` input's widget matches the LHS state ref's declared `valueType` (or the operand's own `value.type`, both already wired via `literalTypeForRhs`); when a same-rule `SetState` action sets the same key, the RHS picker honours that action's `StateValueType` over the operand's.

## Resolved design decisions

These are settled before implementation per the issue's "settle all four" instruction.

- **DQ1 — state-keys catalog source**: B (in-form lookup, no persisted catalog).
  Action state-key combobox reuses the `knownStateKeys` already plumbed through the dialog (from `useSymbolState`/`useGlobalState` hooks).
  State-typed RHS reads from the LHS operand's existing `valueType` field; additionally, when a same-rule prior `SetState` action targets the same key, that action's `StateValueType` takes precedence (best-effort UX, not a hard correctness requirement — the server re-validates).
  Cheapest path; no DB migration; future cross-rule typing can layer on later.
- **DQ2 — common-indicators-across-symbols**: filter applies to `Symbols(list)` only.
  `AllSymbols` and `Symbol` (single) scopes pass every profile indicator through.
  Concretely: when the profile's `scope.type === Symbols`, every rule-selected symbol id must be in `profile.scope.symbolIds` for that profile's indicators to surface (single-pass filter on the profile's scope, not per-instance).
  Profile scope = `All` is always commonly-applicable.
- **DQ3 — operator icon set**: per-icon `lucide-react` imports.
  Consistent with the existing `Plus`/`Trash2` imports in `actions-picker.tsx`; no new icon pack.
  Mapping: Comparison → `ChevronRight`/`ChevronLeft`/`ChevronsRight`/`ChevronsLeft`/`Equal`/`Slash`; Crossing → `Move`/`MoveUpRight`/`MoveDownRight`; Channel → `LogIn`/`LogOut`/`Square`; Moving → `TrendingUp`/`TrendingDown`/`ArrowUpRight`/`ArrowDownRight`; State → `Equal`/`Slash`/`ArrowRight`/`ArrowLeft`.
- **DQ4 — operator family ordering**: engine order (Comparison / Crossing / Channel / Moving / State).
  Matches the source-of-truth `LeafConditionFamily` enum ordering and the existing source-comment grouping in `operator-picker.tsx`.

## Out of scope

- Indicator instance period — the v1 `IndicatorInstance` shape doesn't carry an explicit period; that's tracked separately and unchanged here.
- Persisted state-keys catalog — deferred (DQ1 lazy resolution).
- Virtualization of the symbol pickers — filter + scroll suffices for the stated scale (~hundreds of symbols); virtualization can land later if it becomes a real bottleneck.
