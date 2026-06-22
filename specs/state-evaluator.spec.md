# Spec: state operator evaluator

- Status: implemented
- Touches: `engine` (`packages/engine/src/rules/state-evaluator.ts`).

## Goal

Evaluate a `StateOperator` (`Equals`, `NotEquals`, `ChangesTo`, `ChangesFrom`) against tagged `StateValue` operands.
Returns `false` (never throws) when any required operand is `null` (e.g. first-ever observation has no prev) or when the value types disagree.

## Acceptance criteria

- [ ] `Equals` returns `true` on two identical `Bool` values.
- [ ] `Equals` returns `false` on differing `Bool` values.
- [ ] `Equals` returns `true` on two identical `Enum` values.
- [ ] `Equals` returns `true` on two identical `Number` values.
- [ ] `Equals` returns `true` on two identical `String` values.
- [ ] `Equals` returns `false` on a type mismatch.
- [ ] `Equals` returns `false` when `leftCurrent` is `null`.
- [ ] `NotEquals` returns `true` on differing `Bool` values.
- [ ] `NotEquals` returns `false` on identical `Bool` values.
- [ ] `NotEquals` returns `true` on differing `Enum` values.
- [ ] `NotEquals` returns `false` on a type mismatch (defensive — values are not equal but not actionable).
- [ ] `ChangesTo` fires when `prev` was not the target and `current` is the target.
- [ ] `ChangesTo` does not fire when `prev` was already the target.
- [ ] `ChangesTo` does not fire when `current` is not the target.
- [ ] `ChangesTo` returns `false` on the first-ever observation (no `prev`).
- [ ] `ChangesFrom` fires when `prev` was the source and `current` is not.
- [ ] `ChangesFrom` does not fire when `prev` was not the source.
- [ ] `ChangesFrom` does not fire when `current` is still the source.
- [ ] `ChangesFrom` returns `false` on the first-ever observation (no `prev`).
