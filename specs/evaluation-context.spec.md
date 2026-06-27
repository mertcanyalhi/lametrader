# Spec: evaluation context for a rule event

- Status: implemented
- Touches: `engine` (`packages/engine/src/rules/evaluation-context.ts`).

## Goal

Build a fresh `EvaluationContext` for one inbound `RuleEvent` — pure, taking the event plus a set of injected lookups and never touching I/O or a clock.
The returned context exposes the event's `prev`/`current` in the uniform `StateValue` shape (for telegram templates) and resolves any `ConditionOperand` to its current value (for comparison ops) or its `(prev, current)` pair (for state and crossing ops).

See also: `state-operator-null-and-operand-prev-current.spec.md` for the unified prev/current contract across the evaluator.

## Acceptance criteria

- [ ] A `TimerEvent` yields `prev: null` and `current: null` on the context.
- [ ] An OHLCV-changed event wraps its `prev`/`current` numbers as `StateValueType.Number` on the context.
- [ ] A `SymbolStateChanged` event forwards its `StateValue` `prev`/`current` as-is on the context.
- [ ] A `Literal` operand resolves to its wrapped `StateValue`.
- [ ] A `CurrentValue` operand resolves via the matching lookup wrapped as `StateValueType.Number`.
- [ ] An OHLCV operand resolves to `null` when the event has no `symbolId` (e.g. a `TimerEvent`).
- [ ] An `IndicatorRef` operand resolves via the indicator lookup using its `instanceId` and `stateKey`.
- [ ] A `SymbolStateRef` operand resolves via the symbol-state lookup using the target `symbolId` and the operand's `key`.
- [ ] A `GlobalStateRef` operand resolves via the global-state lookup using the operand's `key`.
- [ ] `resolvePrevCurrent(Literal)` returns `prev = current = literal value`.
- [ ] `resolvePrevCurrent(OHLCV)` returns `(event.prev, event.current)` when the inbound event is the matching `*ValueChanged` for the same `symbolId`; otherwise `(lookup, lookup)`.
- [ ] `resolvePrevCurrent(IndicatorRef)` returns `(event.prev, event.current)` when the inbound event is `IndicatorValueChanged` matching `(instanceId, stateKey)`; otherwise `(lookup, lookup)`.
- [ ] `resolvePrevCurrent(SymbolStateRef)` returns `(event.prev, event.current)` when the inbound event is `SymbolStateChanged` matching `(profileId, symbolId, key)`; otherwise `(lookup, lookup)`.
- [ ] `resolvePrevCurrent(GlobalStateRef)` returns `(event.prev, event.current)` when the inbound event is `GlobalStateChanged` matching `(profileId, key)`; otherwise `(lookup, lookup)`.
