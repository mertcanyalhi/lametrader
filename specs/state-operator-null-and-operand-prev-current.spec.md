# Spec: state-operator null semantics + operand-specific prev/current

- Status: draft
- Touches: `engine` (`packages/engine/src/rules/state-evaluator.ts`, `packages/engine/src/rules/evaluation-context.ts`, `packages/engine/src/rules/evaluation-context.types.ts`, `packages/engine/src/rules/rule-orchestrator.ts`).

## Goal

Tighten two interlocking contracts in the rule evaluator:

1. Treat `null` (unset state) as a distinct sentinel value in `evaluateState` so `Equals XOR NotEquals = true` for every input pair.
2. Resolve operand-specific `prev`/`current` for both state and crossing operators so the operator's history reads off the **operand's** history, not the inbound event's value axis.

Together they make the common BUY/SELL bootstrap pattern (`signal != "SELL"` on the first bar) work and make crossing operators correct on both-sides-moving comparisons (`close CrossingUp ema(N)`).

## Acceptance criteria

### Null sentinel — `evaluateState`

- [ ] `Equals` returns `true` on `(null, null)`.
- [ ] `Equals` returns `false` on `(null, concreteX)`.
- [ ] `Equals` returns `false` on `(concreteX, null)`.
- [ ] `NotEquals` returns `false` on `(null, null)`.
- [ ] `NotEquals` returns `true` on `(null, concreteX)`.
- [ ] `NotEquals` returns `true` on `(concreteX, null)`.
- [ ] `ChangesTo target` returns `true` on `(prev=null, current=target)`.
- [ ] `ChangesTo target` returns `false` on `(prev=null, current=other)`.
- [ ] `ChangesFrom source` returns `true` on `(prev=source, current=null)`.
- [ ] `ChangesFrom source` returns `false` on `(prev=null, current=anything)`.

### Operand-specific prev/current — `EvaluationContext.resolvePrevCurrent`

- [ ] `Literal` resolves to `prev = current = literal value`.
- [ ] OHLCV operand resolves to `(event.prev, event.current)` when the inbound event is the matching `*ValueChanged` for the same `symbolId`.
- [ ] OHLCV operand resolves to `(lookup, lookup)` (no transition) when the inbound event is a different kind or symbol.
- [ ] `IndicatorRef` resolves to `(event.prev, event.current)` when the inbound event is `IndicatorValueChanged` matching `(instanceId, stateKey)`.
- [ ] `IndicatorRef` resolves to `(lookup, lookup)` (no transition) otherwise.
- [ ] `SymbolStateRef` resolves to `(event.prev, event.current)` when the inbound event is `SymbolStateChanged` matching `(profileId, symbolId, key)`.
- [ ] `SymbolStateRef` resolves to `(lookup, lookup)` (no transition) otherwise.
- [ ] `GlobalStateRef` resolves to `(event.prev, event.current)` when the inbound event is `GlobalStateChanged` matching `(profileId, key)`.
- [ ] `GlobalStateRef` resolves to `(lookup, lookup)` (no transition) otherwise.

### Wiring — `evaluateLeaf`

- [ ] State operators receive `left.prev` and `left.current` from `resolvePrevCurrent(leaf.left)`, not from the inbound event's value axis.
- [ ] Crossing operators receive both sides' `prev`/`current` from `resolvePrevCurrent` so both-sides-moving comparisons work.
- [ ] Comparison operators are unchanged — they consume only `.current`.
- [ ] The event-axis `context.prev` / `context.current` fields stay on the context for the telegram template `{prev}` / `{current}` tokens.

## End-to-end expectation

Two end-user observable behaviours, exercised via reshaped e2e suites:

1. **BUY/SELL bootstrap on the first bar.** With no prior `signal` state, a candle whose `Open < threshold` fires the sell rule (`Open < threshold AND signal != "SELL"`) on the very first bar — no pre-seeded `signal = NONE` sentinel needed. Asserted via `mutually-exclusive-rules-312.e2e.test.ts` and `buy-sell-flip-flop.e2e.test.ts` with the workaround removed.

2. **Both-sides-moving crossing.** A `close CrossingUp ema(N)` rule fires precisely on the bar where `close` overtakes the EMA, with both sides reading their own prev/current. Asserted as a new case in `crossing-operators.e2e.test.ts`.

Critical failure mode covered: cascade isolation — when a writer rule fires and sets state, the cascade event must not spuriously re-fire mutually-exclusive sibling rules whose other gates already failed on the inbound event.

## Out of scope

- Adding `IsSet`/`IsNotSet` operators (rejected in the interview — the null-sentinel model makes them unnecessary).
- Adding a `defaultIfNull` field to state-ref operands (rejected — operator-level fix is cleaner).
- Changing `context.prev` / `context.current` semantics for telegram templates — those intentionally remain event-axis values.

## Surprises

_Filled in retroactively if non-obvious gotchas show up._
