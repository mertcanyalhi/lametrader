# Spec: stateless numeric comparison evaluator

- Status: implemented
- Touches: `engine` (`packages/engine/src/rules/comparison-evaluator.ts`).

## Goal

Evaluate a stateless numeric comparison (`gt`, `lt`, `gte`, `lte`, `eq`, `neq`) between two resolved operand values.
Returns `false` (never throws) when either operand is `null`, is not a `StateValueType.Number`, or carries `NaN`, so an unresolved operand or a poisoned value harmlessly drops the leaf.

## Acceptance criteria

- [ ] `gt(2, 1)` returns `true`.
- [ ] `gt(1, 2)` returns `false`.
- [ ] `gt(1, 1)` returns `false`.
- [ ] `lt(1, 2)` returns `true`.
- [ ] `lt(2, 1)` returns `false`.
- [ ] `lt(1, 1)` returns `false`.
- [ ] `gte(2, 1)` returns `true`.
- [ ] `gte(1, 1)` returns `true`.
- [ ] `gte(1, 2)` returns `false`.
- [ ] `lte(1, 2)` returns `true`.
- [ ] `lte(1, 1)` returns `true`.
- [ ] `lte(2, 1)` returns `false`.
- [ ] `eq(1, 1)` returns `true`.
- [ ] `eq(1, 2)` returns `false`.
- [ ] `neq(1, 2)` returns `true`.
- [ ] `neq(1, 1)` returns `false`.
- [ ] Returns `false` (does not throw) when the left operand is `NaN`.
- [ ] Returns `false` (does not throw) when the right operand is `NaN`.
- [ ] Returns `false` when the left operand is `null`.
- [ ] Returns `false` when the right operand is `null`.
- [ ] Returns `false` when an operand is not a `Number` `StateValue`.
