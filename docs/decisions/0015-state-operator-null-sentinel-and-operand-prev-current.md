# State-operator null sentinel + operand-specific prev/current

- Status: accepted

## Context

Two interlocking defects in the rule evaluator:

1. **`evaluateState` short-circuited `null` everywhere.** Any `null` left operand made both `Equals` and `NotEquals` return `false` — so `signal != "SELL"` couldn't fire on the first bar because `signal` was unset. The two operators were jointly non-actionable on the same input, breaking the natural complementarity invariant.
2. **`evaluateLeaf` fed the *event's* prev/current to state and crossing operators.** `context.prev` / `context.current` are derived from the inbound `RuleEvent`'s value axis. For an operator on a different operand (e.g. `state(signal) ChangesTo "SELL"` evaluated on a *candle* event), `context.prev` was the previous candle's price — completely unrelated to `signal`'s history. Crossing was broken symmetrically: the right operand's prev was forced equal to its current, so any `close CrossingUp ema(N)` comparison silently treated `ema` as stationary.

Both surface the same architectural pull: history-aware operators need each operand's own history, not whatever channel happened to fire the event.

## Decision

1. **`null` is a distinct sentinel value in `evaluateState`.** Two `null`s are equal; `null` is unequal to every concrete value; `Equals XOR NotEquals = true` for every input pair. `ChangesTo target` fires on `null → target` (transitioning into the target); `ChangesFrom source` fires on `source → null` (transitioning out of the source). The defensive type-mismatch carve-out on `NotEquals` is preserved (the validator rejects this upstream; the runtime check is belt-and-braces).

2. **`EvaluationContext` exposes `resolvePrevCurrent(operand)`** that returns each operand's own `(prev, current)` pair: from the inbound event payload when the event is the matching `*Changed` for that operand (axis / instance / state key), otherwise from the live lookup as `(value, value)` — no transition for this operand on this event. `evaluateLeaf` consumes it for both state and crossing operators. Comparison operators continue using `.current` only.

3. **`context.prev` / `context.current` stay** as event-axis values for the telegram template `{prev}` / `{current}` tokens. Template authors want "the value went from X to Y on the channel that fired this rule", not "this operand's history" — those are different concerns and intentionally have different APIs.

## Considered Options

- **Treat `null` as SQL-style UNKNOWN (collapse to `false`).** Rejected: gives `Equals XOR NotEquals = true` only for concrete RHS, so the complementarity defect re-emerges when both sides are unset state refs (a valid configuration under `state(a) == state(b)`).
- **Add `IsSet` / `IsNotSet` operators.** Rejected: forces every state-machine rule author to write `IsNotSet(signal) OR signal != "SELL"` to bootstrap the common pattern. Leaks engine internals into every rule's surface.
- **Add `defaultIfNull` to state-ref operands.** Rejected: same surface-leak problem one layer deeper. The operator-level fix is the right altitude.
- **Fix state operators only; leave crossing wired to event-axis prev.** Rejected: the defect is the same shape and the fix is the same `resolvePrevCurrent` infrastructure. Leaving crossing half-fixed creates an obvious pattern asymmetry in `evaluateLeaf` and silently misbehaves on `close CrossingUp ema(N)` configurations.

## Consequences

- The BUY/SELL bootstrap pattern works without pre-seeding `signal` to a sentinel `NONE` literal — `mutually-exclusive-rules-312` and `buy-sell-flip-flop` e2e suites shed their `setSymbolState(NONE, 0)` workarounds.
- `ChangesTo target` now fires on the first set to target (`null → target`). `ChangesFrom source` now fires when `RemoveSymbolState` clears the source (`source → null`). Both behaviour changes are additive — they activate rule fires that previously silently dropped.
- `close CrossingUp ema(N)` (and any other indicator-vs-OHLCV crossing) now correctly compares each axis's own prev to its own current. Both-sides-moving rules behave per the operator's natural-language contract.
- Trace logging is unchanged in shape: `leaf_decision` still records `leftValue` / `rightValue` from `resolveTraced` (current only) plus `leftSource` / `rightSource`. State and crossing operators consult `resolvePrevCurrent` separately for their gates but do not change the trace payload — the trace remains a "what the operator saw" view, with operand-prev visible through the inbound event payload when needed.
