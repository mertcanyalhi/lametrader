# state-ref-operator-families

- Status: draft
- Touches: `packages/web/src/pages/rules/operator-picker.tsx`

## Goal

When the LHS operand is `SymbolStateRef` or `GlobalStateRef`, restrict the operator picker to the Comparison and State families only, regardless of the operand's value type.
Crossing / Channel / Moving silently no-op against state refs because `resolveSeries` collapses them to a singleton series; surfacing those families would mislead users.
Numeric-typed state refs keep `>` / `<` / `>=` / `<=` for thresholding (counters etc.); string-typed state refs keep Equals / NotEquals semantics through Comparison; State family adds `ChangesTo` / `ChangesFrom`.

## Acceptance criteria

- [ ] `legalFamiliesFor` accepts the full `ConditionOperand` (not just `OperandValueKind`) and returns `[Comparison, State]` when the operand kind is `SymbolStateRef`, irrespective of its `valueType`.
- [ ] `legalFamiliesFor` returns `[Comparison, State]` when the operand kind is `GlobalStateRef`, irrespective of its `valueType`.
- [ ] `legalFamiliesFor` keeps the prior value-kind behavior for non-state-ref operands: `Numeric` → all five families; `Bool` / `StringLike` → `[State]` only; `Unknown` → all families.
- [ ] `legalOperatorsFor` for a `SymbolStateRef` LHS surfaces every Comparison + State operator (`Gt`, `Lt`, `Gte`, `Lte`, `Eq`, `Neq`, `Equals`, `NotEquals`, `ChangesTo`, `ChangesFrom`) and hides every Crossing / Channel / Moving operator.
- [ ] `legalOperatorsFor` for a `GlobalStateRef` LHS behaves the same way as for `SymbolStateRef`.

## End-to-end expectation

Covered by the component-level picker test (jsdom): opening the picker with a numeric `SymbolStateRef` LHS shows Comparison + State group headers and hides Crossing / Channel / Moving sections.

## Out of scope

- Engine changes — `resolveSeries` already collapses state refs to a singleton series; this issue only changes what the picker surfaces.
- Schema migration — pre-existing rules with `StateOperator.ChangesTo` against a state ref keep working; only the dropdown choices change.
- The Bool-typed state ref shortcut — `isBoolOperand` continues to hide the operator picker entirely (single-operand sugar persists `Equals(operand, Literal(true))`); no change.

## Surprises

_None yet._
