# Spec: rules-v2 trigger engine + dispatcher

- Status: draft
- Touches: `@lametrader/engine` rules-v2 — pure routing function + per-trigger gates + a tiny in-memory gate-state registry, composed into one `TriggerDispatcher`.

## Goal

Build the dispatch layer that routes each `RulesV2.EvaluationTriggerEvent` to the right trigger kinds (or, for cascade events, to the right condition-slot consumers) and runs each trigger's firing gate.
The orchestrator (#393) drives the dispatcher per inbound event; the dispatcher answers two questions per `(rule, event)` pair — "does this event route to this rule?" and "given the gate state, may this rule fire now?" — and tracks the minimal in-memory state the gates need (OncePerBar latches + OncePerInterval last-fire timestamps).
Condition evaluation, action runs, scope/profile filtering, and the persistent rule store are all *outside* this slice — those land in #393 / #394.

## Acceptance criteria

- [ ] `routes(event, rule)` returns `true` for a `Tick` event against any tick-cadence trigger (`EveryTime` / `Once` / `OncePerBar`) and `false` against any bar-cadence or periodic trigger.
- [ ] `routes(event, rule)` returns `true` for a `BarOpened` event only against `OncePerBarOpen` triggers whose `period` matches the event's period — different period or any other trigger kind returns `false`.
- [ ] `routes(event, rule)` returns `true` for a `BarClosed` event only against `OncePerBarClose` triggers whose `period` matches the event's period — different period or any other trigger kind returns `false`.
- [ ] `routes(event, rule)` returns `true` for a `Timer` event against `OncePerInterval` triggers (cadence enforcement lives in the gate, not in routing) and `false` against any other trigger kind.
- [ ] `routes(event, rule)` returns `true` for a `SymbolStateChanged` event iff the rule's condition tree contains a `SymbolStateRef` operand whose `key` matches the event's `key` — every other trigger-kind / condition-shape combination returns `false`.
- [ ] `routes(event, rule)` returns `true` for a `GlobalStateChanged` event iff the rule's condition tree contains a `GlobalStateRef` operand whose `key` matches the event's `key`.
- [ ] `routes(event, rule)` returns `true` for an `IndicatorChanged` event iff the rule's condition tree contains an `IndicatorRef` operand whose `(instanceId, stateKey)` pair matches the event.
- [ ] `gateAllows(rule, event, state)` returns `true` for `EveryTime` triggers on every call (no gate state read).
- [ ] `gateAllows(rule, event, state)` returns `true` for `Once` triggers on every call (auto-disable is the orchestrator's concern — the gate itself never blocks).
- [ ] `gateAllows(rule, event, state)` returns `true` for `OncePerBar` on the first call after a `BarOpened` reset, and `false` on subsequent calls until `onBarOpened(symbolId, period)` clears the latch.
- [ ] `gateAllows(rule, event, state)` returns `true` for `OncePerBarOpen` and `OncePerBarClose` on every routed call (the bar-lifecycle event itself enforces "once per bar").
- [ ] `gateAllows(rule, event, state)` returns `true` for `OncePerInterval` when no prior fire is recorded or when `event.ts - lastFireAt(rule.id) >= intervalMs`, and `false` when fewer than `intervalMs` have elapsed.
- [ ] `TriggerDispatcher.decide(rule, event, conditionTrue)` returns `true` iff `routes(event, rule)` is `true`, `conditionTrue` is `true`, and the per-trigger gate allows the fire.
- [ ] `TriggerDispatcher.recordFire(rule, event)` latches the OncePerBar gate (so the next `decide` for the same `(rule, symbol)` in the same bar returns `false`) and records `event.ts` as the last-fire timestamp for OncePerInterval (so the next `decide` within `intervalMs` returns `false`).
- [ ] `TriggerDispatcher.onBarOpened(symbolId, period)` clears every latched OncePerBar entry whose `(symbolId, period)` matches — re-arming each affected rule for the next bar window.

## End-to-end expectation

No new e2e in this slice — the dispatcher is a pure dispatch layer with a tiny in-memory state registry, consumed by the orchestrator (#393).
The orchestrator's e2e in #393 covers the full inbound-event → dispatch → condition-eval → gate → action-fire path against real adapters.

## Out of scope

- The condition-tree walker (`And` / `Or` short-circuit) — belongs with the orchestrator (#393); the dispatcher consumes a pre-computed `conditionTrue` boolean.
- Action execution / event-log writes — `ActionRunner` + `EventLog` land in #393.
- Auto-disable of `Once` after first fire — the orchestrator flips `enabled = false` via the rule repository; the dispatcher's gate stays open.
- Profile / symbol scope filtering — owned by the orchestrator's rule-repository query + scope fan-out.
- Persistent firing-state — gate state is in-memory per dispatcher instance; rules running on a fresh process start with a clear gate (the only persistent gating concern, `Once`, is covered by the `enabled` flag).
- A `*.live.test.ts` against real adapters — pure dispatch + an in-memory map; live tier doesn't apply.

## Surprises

_(filled retroactively if anything non-obvious surfaces during implementation)_
