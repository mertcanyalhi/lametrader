# Spec: rules-v2 operator implementations

- Status: draft
- Touches: `@lametrader/engine` rules-v2 — pure operator functions + leaf dispatch + a narrow `resolvePrev` extension on `EvaluationContext` for state operators.

## Goal

Implement every rules-v2 operator (Comparison / Crossing / Channel / Moving / State) as a pure function that consumes the `EvaluationContext` from #389 and produces a boolean.
Each function is the engine's authoritative implementation of one operator family; the family dispatcher routes a `LeafCondition` to the right function based on `leaf.family`.

State operators (`ChangesTo` / `ChangesFrom`) need a previous-snapshot view per operand.
This spec also extends `EvaluationContext` with a narrow `resolvePrev(operand)` and threads optional `getPrev*` hooks through `EvaluationContextDeps` — the minimum needed so state operators can land alongside the other families in one PR.
The orchestrator (#394) is responsible for wiring the prev hooks when it builds the context.

## Acceptance criteria

- [ ] `evaluateComparison(leaf, ctx)` returns `true` for `Gt` when the resolved left number is strictly greater than the resolved right number; reads both operands via `resolveLatest`.
- [ ] `evaluateComparison(leaf, ctx)` returns `false` (does not throw) when either operand resolves to `null`, when their `StateValueType`s differ, or when either numeric value is `NaN`.
- [ ] `evaluateCrossing(leaf, ctx)` returns `true` for `CrossingUp` when the latest left sample is strictly above the right (resampled via `asOf`) and the most recent non-flat historical baseline (walking back on the left's series) was strictly below.
- [ ] `evaluateCrossing(leaf, ctx)` skips historical points where `left === right` (lookback-past-flats) — a consolidation at the threshold followed by a transit still fires `Crossing` (covers the `checkCrossover` / `checkLiteralCrossover` AC fixture with ≥3 consecutive equal points at the boundary).
- [ ] `evaluateCrossing(leaf, ctx)` produces the same verdict whether the right operand updated frequently or rarely inside the walk window — proves the `asOf` resampling decouples cadence from result (cross-frequency AC).
- [ ] `evaluateCrossing(leaf, ctx)` returns `false` when either series is empty, the latest left sits on the boundary, or no non-flat baseline exists in the lookback.
- [ ] `evaluateChannel(leaf, ctx)` returns `true` for `EnteringChannel` when the latest left is strictly inside `(lower, upper)` and the most recent non-on-boundary baseline (walking back) was strictly outside (covers the `checkEnteringChannel` AC fixture with consolidation at the upper or lower bound before entry).
- [ ] `evaluateChannel(leaf, ctx)` returns `true` for `ExitingChannel` when the latest left is strictly outside the band and the most recent non-on-boundary baseline was strictly inside.
- [ ] `evaluateChannel(leaf, ctx)` returns the snapshot `lower < left < upper` for `InsideChannel` (no walk).
- [ ] `evaluateChannel(leaf, ctx)` returns `false` when any series is empty, the latest left sits on a boundary while gated by `Entering` / `Exiting`, or no off-boundary baseline exists.
- [ ] `evaluateMoving(leaf, ctx)` returns `true` for `MovingUp` when `current.value - past.value >= threshold`, where `past` is the sample `lookbackBars` indices before `current` on the left's series.
- [ ] `evaluateMoving(leaf, ctx)` returns `true` for `MovingDownPercent` when `(past.value - current.value) / past.value * 100 >= threshold`, and returns `false` when `past.value` is `0` (no divide-by-zero).
- [ ] `evaluateMoving(leaf, ctx)` returns `false` when the left series has fewer than `lookbackBars + 1` samples.
- [ ] `evaluateState(leaf, ctx)` matches v1's semantics for all four operators: `Equals` / `NotEquals` snapshot, `ChangesTo` (`prev != right && current == right`), `ChangesFrom` (`prev == right && current != right`); `null` is a distinct sentinel (equal to itself, unequal to any concrete value).
- [ ] `evaluateLeaf(leaf, ctx)` dispatches a `LeafCondition` to the right family function by `leaf.family` — covers every variant exactly once.
- [ ] `EvaluationContext.resolvePrev(operand)` returns the previous `StateValue` for any operand: series-eligible operands walk back one point on their series; state-refs and non-numeric indicator refs dispatch to the optional `getPrev*` hooks (or `null` when not supplied); `Literal` returns its constant value.

## End-to-end expectation

No new e2e in this slice — these are pure unit functions consumed by the orchestrator (#394).
An end-to-end test will land with the orchestrator that drives a full inbound event → tree evaluation → action fire path.

## Out of scope

- The condition-tree walker (`And` / `Or` / short-circuit) — small, belongs with the orchestrator (#394).
- Wiring the operators to a live event flow — that's the orchestrator's job.
- A `*.live.test.ts` against real adapters — these are pure functions; live tier doesn't apply.
- Trace logging — emitted by the orchestrator, not by individual operator functions.

## Surprises

_(filled retroactively if anything non-obvious surfaces during implementation)_
