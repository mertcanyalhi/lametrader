# Spec: rules trigger dispatcher

- Status: draft
- Touches: `@lametrader/core` — new `.RuleRepository` port shape; `@lametrader/engine` — new `rules/dispatch/` module (`TriggerDispatcher`, `IntervalScheduler`, condition-tree walker, slot-reference predicate).

## Goal

The dispatch layer that takes each `.RuleEvent` (#388) and routes it to matching rules by trigger granularity, evaluates their condition trees (`evaluateLeaf` from #390 + AND/OR composition), and runs each trigger's firing gate.
Pure routing + per-trigger gates; on fire, delegates to caller-supplied `onFire` callback and (for `Once`) saves the rule disabled via the `RuleRepository.save` path.

Couples cadence to trigger (per ADR 0016): `Tick` events drive only `EveryTime`/`Once`/`OncePerBar`; `BarOpened`/`BarClosed` drive only their matching bar triggers; `Timer` events drive `OncePerInterval`; cascade events (`SymbolStateChanged`/`GlobalStateChanged`/`IndicatorChanged`) drive any rule whose condition tree references the changed slot.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] A `Tick` event on a rule whose `trigger.kind = EveryTime` fires (routing admits the tick).
- [ ] A `Tick` event does NOT fire a rule whose `trigger.kind = OncePerBarOpen` even when the condition is true (per-bar trigger ignores ticks).
- [ ] A `BarOpened` event does NOT fire a rule whose `trigger.kind = EveryTime` even when the condition is true (per-tick trigger ignores bar events).
- [ ] A `BarOpened` event on a rule whose `trigger.kind = OncePerBarOpen` with matching `period` fires.
- [ ] A `BarOpened` event on a rule whose `trigger.kind = OncePerBarOpen` with a DIFFERENT `period` does NOT fire (period must match).
- [ ] A `BarClosed` event on a rule whose `trigger.kind = OncePerBarClose` with matching `period` fires.
- [ ] An `OncePerBar` rule fires on the first matching tick within a bar window; a second matching tick in the same bar is suppressed.
- [ ] After a `BarOpened` for the trigger's `period`, the `OncePerBar` latch re-arms — the next matching tick fires again.
- [ ] A `BarOpened` for a DIFFERENT `period` than the trigger does NOT re-arm the `OncePerBar` latch (period-specific re-arm).
- [ ] A `Once` rule's first fire atomically claims the lifetime via `RuleRepository.claimOnceFire` (which sets `enabled: false`); the racy `get`→`save` auto-disable is gone. See `specs/once-trigger-gate.spec.md` for the lifetime once-ever invariant the claim owns.
- [ ] A `Once` rule whose `claimOnceFire` returns `false` (already claimed, e.g. a concurrent chain won) is gate-blocked and does not fire.
- [ ] A `Once` rule that has already fired (now `enabled: false`) is not returned by `listEnabledForSymbol` and so does not fire again on the next matching tick.
- [ ] `IntervalScheduler.start(rule)` schedules a `Timer` event emission at `intervalMs` boundaries; on each scheduled tick the dispatcher's gate allows a `OncePerInterval` fire regardless of whether a tick or bar arrived in between.
- [ ] `IntervalScheduler.stop(ruleId)` cancels the timer for a single rule (idempotent — stopping an unknown id is a no-op).
- [ ] A `SymbolStateChanged` event routes only to rules whose condition references that `(profileId, symbolId, key)` slot — a rule reading a different key is NOT evaluated.
- [ ] A `GlobalStateChanged` event routes only to rules whose condition references that `(profileId, key)` slot.
- [ ] An `IndicatorChanged` event routes only to rules whose condition references that `(instanceId, stateKey)` slot — a rule reading a different instance is NOT evaluated.
- [ ] When the condition tree evaluates to `false`, no fire occurs regardless of trigger.
- [ ] `referencesSlot` recurses into nested `And`/`Or` groups (the slot lookup walks the whole tree).

## End-to-end expectation

A `*.e2e.test.ts` drives the full slice end-to-end on an in-memory `RuleRepository` + a fake `EvaluationContext` builder:
1. Seed three rules — an `EveryTime` on `Price > 100`, a `OncePerBar` on the same condition with `period = OneMinute`, and a `Once` on the same condition.
2. Push two `Tick` events at `price = 120` within the same minute, then a `BarOpened(OneMinute)` event, then another `Tick` at `price = 120`.
3. Assert the fire log: `EveryTime` fires three times, `OncePerBar` fires twice (once per bar), `Once` fires once and the rule is now `enabled: false` in the repo.
4. Critical failure mode: a `Tick` event with no matching enabled rules in the repo is a no-op (dispatcher returns an empty fire list without throwing).

## Out of scope

- Condition operand prev/current resolution beyond what `evaluateLeaf` already does — that's #390's surface.
- Profile / parent enabled-toggle filtering — `RuleRepository.listEnabledForSymbol` already enforces it (per #281).
- Action execution (`ActionRunner`) — #393's surface.
- Bridges that translate Polling/Quote events to `.RuleEvent` — #392's surface.
- Mongo `RuleRepository` adapter — #394 owns it; this slice only defines the port + an in-memory fake.
- AllSymbols / Symbols fan-out across watched symbols — the orchestrator (#393) owns scope expansion; this slice's dispatcher fires per-`firingSymbolId` given to it.
- Cycle guard for cascading state mutations — orchestrator (#393) owns it.
- Tick-axis filtering on the firing symbol — the bridges (#392) emit per-symbol events; the dispatcher uses the event's `symbolId` directly.

## Surprises

(empty for now)
