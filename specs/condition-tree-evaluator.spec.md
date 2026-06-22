# Spec: condition tree evaluator

- Status: implemented
- Touches: `engine` (`packages/engine/src/rules/condition-tree-evaluator.ts`).

## Goal

Walk a `ConditionNode` tree and reduce it to a boolean, delegating per-leaf judgement to a pluggable `LeafEvaluator` callback.
`And` short-circuits on the first `false` and `Or` short-circuits on the first `true`, keeping the operator-specific evaluators decoupled from the tree walker.

## Acceptance criteria

- [ ] A single `Leaf` returns the leaf evaluator's result directly.
- [ ] An `And` node returns `true` only when every child evaluates to `true`.
- [ ] An `And` node returns `false` when any child evaluates to `false`.
- [ ] An `Or` node returns `true` once any child evaluates to `true`.
- [ ] An `Or` node returns `false` when every child evaluates to `false`.
- [ ] An `And` short-circuits on the first `false` — later leaves are not evaluated.
- [ ] An `Or` short-circuits on the first `true` — later leaves are not evaluated.
- [ ] Walks a deeply nested mix of `And`/`Or` correctly.
