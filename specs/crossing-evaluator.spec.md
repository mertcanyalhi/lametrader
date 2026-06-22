# Spec: crossing operator evaluator

- Status: implemented
- Touches: `engine` (`packages/engine/src/rules/crossing-evaluator.ts`).

## Goal

Evaluate the history-aware `Crossing`, `CrossingUp`, and `CrossingDown` numeric operators using both the previous and current values of left and right.
Returns `false` (never throws) if any value is `null` (first-ever observation has no prev), is not a `StateValueType.Number`, or is `NaN`.

## Acceptance criteria

- [ ] `CrossingUp` fires when left moves from below right to above right.
- [ ] `CrossingUp` does not fire when left stays below right.
- [ ] `CrossingUp` does not fire when left touches right but does not cross past it.
- [ ] `CrossingDown` fires when left moves from above right to below right.
- [ ] `CrossingDown` does not fire when left stays above right.
- [ ] `CrossingDown` does not fire when left touches right but does not cross past it.
- [ ] `Crossing` fires for an up-crossing.
- [ ] `Crossing` fires for a down-crossing.
- [ ] `Crossing` does not fire when both stay on the same side with no crossing.
- [ ] `Crossing` does not fire when left touches right but does not cross.
- [ ] Returns `false` when `leftPrev` is `null` (first-ever observation has no prev).
- [ ] Returns `false` when `rightPrev` is `null`.
- [ ] Returns `false` when any value is `NaN`.
- [ ] Returns `false` when an operand is not a `Number` `StateValue`.
