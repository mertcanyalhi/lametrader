# Spec: state operator evaluator

- Status: implemented
- Touches: `engine` (`packages/engine/src/rules/state-evaluator.ts`).

## Goal

Evaluate a `StateOperator` (`Equals`, `NotEquals`, `ChangesTo`, `ChangesFrom`) against tagged `StateValue` operands.
Treats `null` as a distinct sentinel value (the "unset" value) so `Equals XOR NotEquals = true` for every input pair and `ChangesTo` / `ChangesFrom` detect transitions across the null edge.
Returns `false` (never throws) on type mismatch.

See also: `state-operator-null-and-operand-prev-current.spec.md` for the unified contract across the evaluator and the context resolver.

## Acceptance criteria

- [ ] `Equals` returns `true` on two identical `Bool` values.
- [ ] `Equals` returns `false` on differing `Bool` values.
- [ ] `Equals` returns `true` on two identical `Enum` values.
- [ ] `Equals` returns `true` on two identical `Number` values.
- [ ] `Equals` returns `true` on two identical `String` values.
- [ ] `Equals` returns `false` on a type mismatch.
- [ ] `Equals` returns `true` on `(null, null)`.
- [ ] `Equals` returns `false` on `(null, concreteX)`.
- [ ] `Equals` returns `false` on `(concreteX, null)`.
- [ ] `NotEquals` returns `true` on differing `Bool` values.
- [ ] `NotEquals` returns `false` on identical `Bool` values.
- [ ] `NotEquals` returns `true` on differing `Enum` values.
- [ ] `NotEquals` returns `false` on a type mismatch (defensive — values are not equal but not actionable).
- [ ] `NotEquals` returns `false` on `(null, null)`.
- [ ] `NotEquals` returns `true` on `(null, concreteX)`.
- [ ] `NotEquals` returns `true` on `(concreteX, null)`.
- [ ] `ChangesTo` fires when `prev` was not the target and `current` is the target.
- [ ] `ChangesTo` does not fire when `prev` was already the target.
- [ ] `ChangesTo` does not fire when `current` is not the target.
- [ ] `ChangesTo` fires on `(prev=null, current=target)` — null edge counts as a transition into target.
- [ ] `ChangesFrom` fires when `prev` was the source and `current` is not.
- [ ] `ChangesFrom` does not fire when `prev` was not the source.
- [ ] `ChangesFrom` does not fire when `current` is still the source.
- [ ] `ChangesFrom` fires on `(prev=source, current=null)` — null edge counts as a transition out of source.
- [ ] `ChangesFrom` does not fire on `(prev=null, current=anything)` — can't change from a source that was never observed.
