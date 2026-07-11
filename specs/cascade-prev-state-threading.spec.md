# Spec: cascade events thread `prev` state through `getPrevSymbolState` / `getPrevGlobalState`

- Status: draft
- Touches: `packages/engine/src/rules/wire/wire-rule-engine.ts`, `packages/engine/src/rules/wire/wire-rule-engine.test.ts`, `packages/engine/tests/e2e/rules-wire-engine.e2e.test.ts`.

## Goal

State operators `ChangesTo` and `ChangesFrom` need the previous slot value to detect a transition.
On the cascade path, the production wire-up in `wireRuleEngine.buildContext` hardcodes `getPrevSymbolState: () => null` and `getPrevGlobalState: () => null`, so transition operators never see the prior value the cascade event already carries — they short-circuit to `false` (`ChangesFrom`) or fire on an incorrect premise (`ChangesTo`).

The cascade `SymbolStateChanged` / `GlobalStateChanged` event already carries both `prev` and `current` (per `StateCascadeBridge.handleStateChange`).
This fix threads `event.prev` into the matching `(profileId, key[, symbolId])` slot at context-build time so transition operators evaluate against the real prior value.

Per the issue, non-cascade paths (tick, bar, timer) stay at `null` for `getPrev*State` — the issue explicitly defers that broader question and notes the cascade path is the immediate fix.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] When the inbound event is `SymbolStateChanged{profileId, symbolId, key, prev}`, `wireRuleEngine`'s `buildContext` returns a context whose `getPrevSymbolState(profileId, symbolId, key)` returns `event.prev` (not `null`); lookups for any OTHER `(profileId, symbolId, key)` still return `null`.
- [ ] When the inbound event is `GlobalStateChanged{profileId, key, prev}`, `wireRuleEngine`'s `buildContext` returns a context whose `getPrevGlobalState(profileId, key)` returns `event.prev`; lookups for any OTHER `(profileId, key)` still return `null`.
- [ ] When the inbound event is NOT a state-cascade event (tick / bar / indicator / timer), `getPrevSymbolState` and `getPrevGlobalState` still return `null` for every slot (no regression on the non-cascade paths until the larger question is settled).
- [ ] Cascade `SymbolStateChanged{prev: "off", current: "on", key: "phase"}` event on a rule whose condition is `ChangesTo(SymbolStateRef("phase"), "on")` causes the rule to fire (the unit-level dispatch path proves the wiring).
- [ ] Cascade `SymbolStateChanged{prev: "on", current: "off", key: "phase"}` event on a rule whose condition is `ChangesFrom(SymbolStateRef("phase"), "on")` causes the rule to fire.

## End-to-end expectation

A new e2e test wires the real `wireRuleEngine`, persists rule A (`Price > 100` → `SetSymbolState(key="phase", value="on")`) and rule B (`ChangesTo(SymbolStateRef("phase"), "on")` → notification).
Driving one tick at `price=101` fires rule A, whose `SetSymbolState` cascades a `SymbolStateChanged` event; rule B observes the cascade with `prev=null, current="on"`, evaluates `ChangesTo` to true, and fires within the same tick.
The cascade event's `prev` is threaded into the per-slot `getPrevSymbolState`, so `ChangesTo` sees `prev !== current` and admits the fire.

## Out of scope

- Threading non-null `getPrev*State` on the non-cascade paths (tick / bar / timer).
  The issue calls this out as larger scope and asks to settle it separately.
  The immediate fix is the cascade path only.
- Indicator-cascade prev threading — an `IndicatorRef`'s `prev` is derived from the indicator series store's second-newest projected point in `buildEvaluationContext`; no wire-up change needed for that path. (The earlier optional `getPrevIndicator` fallback was removed in #562 once bool/string fields projected through the same series path.)

## Surprises

(filled retroactively)
