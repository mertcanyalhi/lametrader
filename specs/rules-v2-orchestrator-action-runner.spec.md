# Spec: rules-v2 orchestrator + action runner

- Status: draft
- Touches: `@lametrader/core` (`RulesV2` namespace: `RuleEventType` enum, `RuleEventEntry` tagged union, `RuleEventContext`, `RuleEventLookupSnapshot`, `EventLog` port), `@lametrader/engine` (new `rules-v2/orchestrator/*` module: `RuleOrchestrator`, `ActionRunner`, `CycleGuard`, per-symbol serializer, `InMemoryEventLog`).

## Goal

Wire the existing rules-v2 pieces (#388 core types, #389 lookups, #390 condition operators, #391 dispatcher, #392 bridges) into an end-to-end engine: a `RuleOrchestrator` that drains each `EvaluationTriggerEvent` through the dispatcher and runs each fire's actions, plus an `ActionRunner` that executes the v2 `Notification` + state-mutation actions and produces the rule-event log entries.
Preserves v1's profile-aware filtering (#281, #290), per-symbol serialization (#307), cascade cycle guard (ADR 0012), `Once` auto-disable, AllSymbols / Symbols fan-out, and structured trace (#354).

## Acceptance criteria

Each bullet maps to exactly one test.

### Core types (`RulesV2` namespace in `@lametrader/core`)

- [ ] `RulesV2.RuleEventType` enum carries `Fired`, `NotificationSent`, `StateSet`, `StateRemoved`, `Error`, `CycleOverflow` string-valued variants.
- [ ] `RulesV2.RuleEventEntry` tagged union has one branch per `RuleEventType` carrying the type-specific payload (`Fired` carries `RuleEventContext`; `StateSet` carries `scope` + `key` + `value`; `StateRemoved` carries `scope` + `key`; `NotificationSent` carries `destinationName` + `body`; `Error` carries `reason`; `CycleOverflow` carries `cycleLimit`).

### In-memory event log (`@lametrader/engine`)

- [ ] `InMemoryEventLog.appendRuleEvent(ruleId, entry)` followed by `ruleEvents(ruleId)` returns `[entry-with-firedAt]` (stamps `firedAt` if absent).
- [ ] `InMemoryEventLog.appendSymbolEvent(symbolId, entry)` followed by `symbolEvents(symbolId)` returns `[entry-with-firedAt]`.
- [ ] `InMemoryEventLog.onAppend(listener)` invokes `listener` once per append with the stamped entry and a `target` discriminating rule vs symbol.

### Cycle guard

- [ ] `CycleGuard.enter()` throws `CycleOverflowError(limit)` once the count exceeds the constructor `limit`; the error carries the breached `limit`.

### Per-symbol serializer

- [ ] Successive events for the same `symbolId` run sequentially; events whose `symbolId` is `undefined` (Timer / GlobalStateChanged) share one global chain; `drain()` resolves once every chain settles.

### Action runner

- [ ] `Notification(channel=telegram)` action calls `notifier.send(destinationName, rendered body)` and returns `[NotificationSent, Fired]` with the `Fired.context` capturing the inbound event + OHLCV lookup snapshot.
- [ ] `Notification` action whose template references an unknown token returns `[Error, Fired]` and does NOT call the notifier.
- [ ] `Notification` action whose notifier throws `UnknownDestinationError` returns `[Error, Fired]` carrying the error message as `reason`.
- [ ] `SetSymbolState` action writes through `state.setSymbolState(profileId, firingSymbolId, key, value, ts)` and returns `[StateSet{scope: Symbol}, Fired]`.
- [ ] `RemoveSymbolState` action writes through `state.removeSymbolState(profileId, firingSymbolId, key, ts)` and returns `[StateRemoved{scope: Symbol}, Fired]`.
- [ ] `SetGlobalState` action writes through `state.setGlobalState(profileId, key, value, ts)` and returns `[StateSet{scope: Global}, Fired]`.
- [ ] `RemoveGlobalState` action writes through `state.removeGlobalState(profileId, key, ts)` and returns `[StateRemoved{scope: Global}, Fired]`.

### Orchestrator (end-to-end against in-memory infra)

- [ ] A `Tick` event on an enabled `EveryTime` rule with `Price > 100` and one `Notification` action fires once and appends `[NotificationSent, Fired]` to both the rule's and the firing symbol's events log.
- [ ] `Once` trigger: after the first fire, the rule is saved back to the repository with `enabled: false`.
- [ ] `OncePerBar` trigger: a burst of three ticks within the same bar window fires the rule exactly once.
- [ ] State-mutation action's `SymbolStateChanged` cascade fires a downstream rule whose condition reads the mutated state key within the same `process()` call (under cycle guard).
- [ ] Multi-profile fan-out: a `Tick` with one matching rule on profile A and another on profile B fires both rules (one append to each rule's log).
- [ ] `AllSymbols` scope on a symbol-less `Timer` event fires the rule once per watched symbol.
- [ ] `Symbols(list)` scope on a symbol-less `Timer` event fires the rule once per symbol in `scope.symbolIds`.
- [ ] A cycle overflow during cascade emits exactly one `CycleOverflow` entry on the affected symbol's log and halts further cascade.

## End-to-end expectation

A `Tick(price=120)` event for an enabled `EveryTime` rule (`Price > 100`, one Telegram `Notification` action) drives the wired orchestrator: the notifier records one send with the rendered body, and both the rule's and the firing symbol's event logs end with `[NotificationSent, Fired]` (the `Fired` entry's `context.inboundEvent` is the tick and the `lookupSnapshot.current` is `120`).

Critical failure mode: a cascade of state mutations that exceed the cycle limit emits exactly one `CycleOverflow` entry on the symbol's log and halts further processing; no further rules fire.

## Out of scope

- Mongo `EventLog` and `RuleRepository` adapters — owned by #394.
- A top-level `wireRuleEngineV2` helper that subscribes the bridges to the upstream services and exposes a single chain — defer until a consumer wires it (HTTP / CLI in a later issue); the e2e wires the pieces inline.
- `DataUpdateEvent` flow that warms the lookups cache — the orchestrator reads from already-warm `EvaluationLookups`; the warming path is owned by the bridges / lookups layer.
- `Expired` rule events — the dispatcher's `listEnabledForSymbol` already drops expired rules at the lookup boundary (the v2 `Rule.expiration` enforcement; orchestrator doesn't need to re-emit one).
- `IntervalScheduler` wiring into the orchestrator (already shipped in #391); the e2e tests `OncePerInterval` indirectly through the dispatcher.
- `leaf_decision` / `gate_decision` trace events — defer until a debugging consumer (live debug UI) needs them; the existing `event_received`, `rule_starting`, `rule_summary` traces cover the happy path. The Outcome enum carries Fired/NotFired/Expired/CycleOverflow so the rule_summary line tells the story.

## Surprises

(empty for now — fill in retroactively if anything bites during implementation)
