# Spec: rules-narrow-operators-by-state-key-type

- Status: approved
- Touches: `packages/ui/src/pages/rules/operator-picker.tsx` (with derive-type verification in `packages/ui/src/pages/rules/operand-picker.tsx`).

## Goal

In the rule editor, when a condition's LHS is a `SymbolStateRef` / `GlobalStateRef`, the operator dropdown must be narrowed to what the picked state key's type supports.
Today the picker offers the full ordering set (`>`, `<`, `>=`, `<=`) for every state ref regardless of its `valueType`, so a `Bool` or `String` state key wrongly exposes ordering comparators.
The `valueType` is already derived automatically from the picked known key (via #454's `StateKeyPicker` + the known-key catalog) and from an indicator's schema (#455); this closes the remaining gap by narrowing the operators to that type.

## Decision: enum-ish keys resolve through `String`

`StateValueType` is `{ String, Number, Bool }` — it has no `Enum` member (an enum state key resolves to a plain string at eval time).
So issue #457's "Enum" acceptance case is exercised through a `String`-typed key: it behaves identically to any other string key (equality + transitions, no ordering comparators).

## Decision: narrow the operators, not the families

`legalFamiliesFor` keeps returning `[Comparison, State]` for every state ref (numeric or not) — the family set is unchanged, so the existing `legalFamiliesFor` tests hold.
The ordering comparators are dropped inside `legalOperatorsFor`, which already grafts the collapsed `Eq`/`Neq` entries onto `State.Equals`/`State.NotEquals` for state-dispatch LHS.
For a non-numeric state ref the Comparison group then contributes no operator and is hidden by the picker's empty-group guard.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] `legalOperatorsFor` for a `Number`-typed `SymbolStateRef` LHS keeps the full set: `>`, `<`, `>=`, `<=`, `State.Equals`, `State.NotEquals`, `State.ChangesTo`, `State.ChangesFrom`.
- [ ] `legalOperatorsFor` for a `Bool`-typed `SymbolStateRef` LHS drops the ordering comparators and yields only `State.Equals`, `State.NotEquals`, `State.ChangesTo`, `State.ChangesFrom`.
- [ ] `legalOperatorsFor` for a `String`-typed `SymbolStateRef` LHS drops the ordering comparators and yields only `State.Equals`, `State.NotEquals`, `State.ChangesTo`, `State.ChangesFrom`.
- [ ] `legalOperatorsFor` for a `Bool`-typed `GlobalStateRef` LHS drops the ordering comparators and yields only `State.Equals`, `State.NotEquals`, `State.ChangesTo`, `State.ChangesFrom`.
- [ ] `legalOperatorsFor` for a `String`-typed (enum-backed) `GlobalStateRef` LHS drops the ordering comparators and yields only `State.Equals`, `State.NotEquals`, `State.ChangesTo`, `State.ChangesFrom`.
- [ ] The `OperatorPicker` renders no Comparison group header for a `Bool`-typed `SymbolStateRef` LHS (only the State group shows).
- [ ] `OperandPicker` adopts a known `Number`-typed symbol-state key's `valueType` and hides the "Value type" row on pick (AC1/AC2 verification).
- [ ] `OperandPicker` adopts a known `String`-typed (enum-backed) global-state key's `valueType` and hides the "Value type" row on pick (AC1/AC2 verification).

## End-to-end expectation

No new e2e — this is a UI refinement inside the already-wired rule editor, fully covered at the operator-picker / operand-picker unit-test level (mirrors #455's `indicator-operand-state-schema-select` decision).
The existing rules e2e continues to pass unmodified.

## Out of scope

- Any `StateValueType.Enum` core member or backend rule-engine change (see the decision above).
- Changing `legalFamiliesFor`'s returned family set for state refs (the narrowing is operator-level).
- The RHS literal-editor type wiring (AC4) already flows through `resolveRhsLiteralType → literalTypeForRhs → operandValueKind`, which reads the ref's `valueType`; it is verified by the existing leaf-editor tests, not re-built here.

## Surprises

_None yet._
