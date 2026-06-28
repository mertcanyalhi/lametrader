# Spec: rules-v2 orchestrator + action runner

- Status: draft
- Touches: `@lametrader/core` (RulesV2 namespace: `RuleEventEntry`, `RuleEventType`, `RuleEventContext`, `RuleEventLookupSnapshot`, `EventLog`, `RuleRepository`), `@lametrader/engine` (`rules-v2/orchestrator/*`)

## Goal

Wire the rules-v2 pieces (#388 types, #389 lookups, #390 condition evaluator, #391 dispatcher, #392 bridges) into an end-to-end engine: a `RuleOrchestrator` that drives enabled v2 rules on each inbound `EvaluationTriggerEvent`, and an `ActionRunner` that executes their `then` clause and produces the rule-event entries persisted to the v2 events log.
Preserves v1's profile-aware filtering (#281, #290), per-symbol serialization (#307), cascade cycle guard (ADR 0012), structured trace (#354), AllSymbols / Symbols fan-out, and `Once` auto-disable.

## Acceptance criteria

Each bullet maps to exactly one test.

### Core types (RulesV2 namespace in `@lametrader/core`)

- [ ] `RuleEventType` v2 enum carries `Fired`, `NotificationSent`, `StateSet`, `StateRemoved`, `Error`, `Expired`, `CycleOverflow` string-valued variants.
- [ ] `RuleEventEntry` v2 union has one branch per `RuleEventType` carrying the type-specific payload (`Fired` carries `RuleEventContext`; `StateSet` / `StateRemoved` carry `scope` + `key` (+ `value`); `NotificationSent` carries `destinationName` + `body`; `Error` carries `reason`; `CycleOverflow` carries `cycleLimit`).
- [ ] `EventLog` v2 port exposes `appendRuleEvent(ruleId, entry)`, `appendSymbolEvent(symbolId, entry)`, `ruleEvents(ruleId)`, `symbolEvents(symbolId)`, `onAppend(listener)`.
- [ ] `RuleRepository` v2 port exposes `get(id)`, `list()`, `save(rule)`, `remove(id)`, `listEnabledForSymbol(symbolId|null, profileId?)`.

### In-memory adapters (`@lametrader/engine`, `rules-v2/orchestrator/`)

- [ ] `InMemoryEventLog` appends to the rule's array and the symbol's array independently, stamps `firedAt` on append, and fires `onAppend` listeners once per side with the matching target discriminator.
- [ ] `InMemoryRuleRepository.listEnabledForSymbol(symbolId, profileId?)` returns only enabled rules whose scope matches `symbolId` (Symbol with matching id / Symbols containing the id / AllSymbols) and whose `profileId` matches the filter when one is given.
- [ ] `InMemoryRuleRepository.listEnabledForSymbol(null, profileId?)` returns every enabled rule on the matching profile regardless of scope (so symbol-less events — Timer, GlobalStateChanged — can still wake Symbol- and Symbols-scoped rules for fan-out).

### Cycle guard + per-symbol serializer (ported from v1, retyped to v2 events)

- [ ] `CycleGuard.enter()` throws `CycleOverflowError(limit)` once the count exceeds the constructor `limit`; the error carries the breached `limit`.
- [ ] Per-symbol serializer runs successive events for the same `symbolId` sequentially while events for different symbol ids may run concurrently; events whose `symbolId` is absent (Timer / GlobalStateChanged) share a single global chain.
- [ ] Per-symbol serializer's `drain()` resolves once every per-symbol and the global chain settle.

### Action runner

- [ ] `NotificationAction` (Telegram channel) calls `notifier.send(destinationName, rendered body)` and produces `[NotificationSent, Fired]`; the `Fired` entry's `context` captures the inbound event + an OHLCV lookup snapshot for the firing symbol.
- [ ] `SetSymbolState` action calls `state.setSymbolState(rule.profileId, firingSymbolId, key, value, ts)` and produces a `StateSet` entry with `scope: Symbol`.
- [ ] `RemoveSymbolState` action calls `state.removeSymbolState(rule.profileId, firingSymbolId, key, ts)` and produces a `StateRemoved` entry with `scope: Symbol`.
- [ ] `SetGlobalState` action calls `state.setGlobalState(rule.profileId, key, value, ts)` and produces a `StateSet` entry with `scope: Global`.
- [ ] `RemoveGlobalState` action calls `state.removeGlobalState(rule.profileId, key, ts)` and produces a `StateRemoved` entry with `scope: Global`.
- [ ] Notifier throwing `UnknownDestinationError` (or any other `Error`) on a Telegram action produces an `Error` entry (not a `NotificationSent`) carrying the thrown message as `reason`.
- [ ] Unknown template token in a Telegram action produces an `Error` entry without calling the notifier.

### Orchestrator (end-to-end, against in-memory infra)

- [ ] A `Tick` event for an enabled `EveryTime` rule with a `Price > 100` condition (and one Telegram action) fires once and appends both a `Fired` entry and a `NotificationSent` entry to the firing symbol's events log and the rule's events log.
- [ ] `Once` trigger: after the first fire, the rule is saved back to the repository with `enabled: false`.
- [ ] `OncePerBar` trigger: a burst of ticks within a bar of the trigger's `period` fires the rule at most once; a subsequent `BarOpened` event for the same `(symbolId, period)` re-arms the latch, and the next tick fires again.
- [ ] State-mutation action's `SymbolStateChanged` cascade fires a downstream same-profile rule whose condition reads the mutated state key within the same tick.
- [ ] Multi-profile fan-out: a single `Tick` event with one matching rule in profile A and one matching rule in profile B fires both rules.
- [ ] AllSymbols scope on a `Timer` event fans out and fires the rule once per watched symbol.
- [ ] Symbols scope on a `Timer` event fans out and fires the rule once per symbol in `scope.symbolIds`.
- [ ] Cycle overflow during cascade emits exactly one `CycleOverflow` entry on the affected symbol's log and halts further cascade.

## End-to-end expectation

A Telegram-bound `Price > 100` rule on profile A and BTC fires once when a `Tick(price=120, ts=t0)` arrives — the symbol's events log records `[NotificationSent(body matches template), Fired(context.inboundEvent=tick)]`, the rule's events log records the same two entries, and the notifier was called exactly once with the rendered body.
Critical failure mode: an unknown template token in the action produces an `Error` entry instead and never calls the notifier.

## Out of scope

- v2 Mongo persistence (`rules_v2` collection + Mongo `EventLog` adapter) — owned by #394.
- Wire-up helper (`wireRuleEngine` v2 equivalent that composes bridges + dispatcher + orchestrator + lookups into a `WiredRuleEngine`) — defers until a consumer needs it (HTTP / CLI integration in a later issue).
- `DataUpdateEvent` flow into the lookups (warming the caches) — the orchestrator builds an evaluation context from already-warm lookups; the warming path is the bridges' / lookups' concern.
- IndicatorBridge orchestration (binding subscriptions to instances) — owned by #395 / wherever indicator instances boot.
- Re-arming the dispatcher's OncePerBar latches via `dispatcher.onBarOpened` is wired here, but its broader integration with the bridge fan-out belongs to the wire-up helper.

## Surprises

(empty — fill in retroactively if anything bites during implementation)
