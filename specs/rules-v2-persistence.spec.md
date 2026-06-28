# Spec: rules-v2 persistence (rules_v2 collection + Mongo RuleRepository + Mongo EventLog)

- Status: draft
- Touches: `RulesV2.RuleRepository` port (Mongo adapter), `RulesV2.EventLog` port (Mongo adapter), shared contract suites against in-memory + Mongo

## Goal

Land the Mongo persistence layer for the v2 rule engine in its own greenfield collection so the v1 and v2 engines coexist behind the feature flag (per ADR 0016, #387).
A `rules_v2` collection holds the v2 `Rule` document, and the v2 `EventLog` mirrors fired entries onto each rule's embedded `events` array plus a new `events_v2` array on the affected symbol's `watchlist` document — leaving v1's `events`, `history`, and `firingState` arrays untouched.
Both the Mongo and existing in-memory adapters run through one shared contract suite so the ports-and-adapters discipline is enforced (per ADR 0001).

## Acceptance criteria

Each bullet maps to exactly one test.

### `RulesV2.RuleRepository` shared contract (runs against in-memory + Mongo)

- [ ] `save` then `get` returns the stored rule unchanged.
- [ ] `get` returns `null` for an unknown id.
- [ ] `save` replaces an existing rule by id (last write wins).
- [ ] `remove` deletes the rule by id.
- [ ] `remove` is idempotent (no-op when the id is absent).
- [ ] `list` returns every stored rule.
- [ ] `listEnabledForSymbol(symbolId)` returns enabled Symbol-scoped rules whose `scope.symbolId` matches.
- [ ] `listEnabledForSymbol(symbolId)` returns enabled Symbols-scoped rules whose `scope.symbolIds` contains the id.
- [ ] `listEnabledForSymbol(symbolId)` always includes enabled AllSymbols-scoped rules.
- [ ] `listEnabledForSymbol(symbolId)` excludes a rule whose own `enabled` is `false`.
- [ ] `listEnabledForSymbol(symbolId)` excludes Symbol-scoped rules with a different `scope.symbolId`.
- [ ] `listEnabledForSymbol(symbolId)` excludes Symbols-scoped rules whose `scope.symbolIds` does not contain the id.
- [ ] `listEnabledForSymbol(symbolId, profileId)` restricts to rules with matching `profileId`.
- [ ] `listEnabledForSymbol(null)` returns every enabled rule regardless of scope (the symbol-less fan-out used for Timer / GlobalStateChanged).
- [ ] `listEnabledForSymbol(null, profileId)` returns every enabled rule on the matching profile regardless of scope.
- [ ] Round-trips every `Trigger` variant — `EveryTime`, `Once`, `OncePerBar`, `OncePerBarOpen`, `OncePerBarClose`, `OncePerInterval` (full-payload).
- [ ] Round-trips every `RuleScope` variant — `Symbol`, `Symbols`, `AllSymbols` (full-payload).
- [ ] Round-trips every `Action` variant — `Notification`, `SetSymbolState`, `RemoveSymbolState`, `SetGlobalState`, `RemoveGlobalState` (full-payload).
- [ ] Round-trips an `And` / `Or` / nested `ConditionNode` tree with one leaf per `LeafConditionFamily` (`Comparison`, `Crossing`, `Channel`, `Moving`, `State`) (full-payload).

### `RulesV2.EventLog` shared contract (runs against in-memory + Mongo)

- [ ] `appendRuleEvent` stamps `firedAt` from the injected clock, and `ruleEvents` returns the stamped entries in append order.
- [ ] `appendSymbolEvent` stamps `firedAt` from the injected clock, and `symbolEvents` returns the stamped entries in append order.
- [ ] A caller-supplied `firedAt` is preserved so mirrored writes (rule + symbol) share the same stamp.
- [ ] `onAppend` fires once per append with the stamped entry and a `target` discriminating which side was written (`'rule'` vs `'symbol'`).
- [ ] `ruleEvents` returns `[]` for an id with no events stored.
- [ ] `symbolEvents` returns `[]` for an id with no events stored.
- [ ] Round-trips every `RuleEventEntry` variant — `Fired` (with `context.inboundEvent` + `lookupSnapshot`), `CycleOverflow`, `StateSet` (Symbol scope), `StateSet` (Global scope), `StateRemoved`, `NotificationSent`, `Error`, `Expired` (full-payload).

### Mongo-only behaviour

- [ ] `MongoRuleRepository.ensureIndexes` creates the orchestrator hot-path indexes (`{ profileId: 1, 'scope.symbolId': 1, enabled: 1 }`, `{ enabled: 1, 'scope.symbolIds': 1 }`, `{ enabled: 1, 'scope.kind': 1 }`) — idempotent.
- [ ] `MongoEventLog` writes rule events to `rules_v2.{ruleId}.events` and symbol events to `watchlist.{symbolId}.events_v2`, leaving v1's `rules.events` / `watchlist.events` untouched.

## End-to-end expectation

Two e2e suites against a `Testcontainers` Mongo:

1. `rules-v2-rule-repository.e2e.test.ts` — instantiates `RulesV2.MongoRuleRepository` against a fresh DB, runs the shared `runRuleRepositoryContract`.
2. `rules-v2-event-log.e2e.test.ts` — instantiates `RulesV2.MongoEventLog` against a fresh DB, runs the shared `runEventLogContract`.

The critical failure mode (writing to an unknown rule/symbol id): the v1 contract's behavior is that `$push` against a missing doc is effectively a no-op (`matchedCount === 0`); v2 mirrors that — reads against the absent id return `[]`. The contract asserts the empty-array reads cover that.

## Out of scope

- Profile-enabled (`profile.enabled` kill-switch) filtering — deferred until profiles-v2 lands (the v2 in-memory adapter defers this too).
- Migration from v1 `rules` → v2 `rules_v2` — landed separately under #397 (cleanup).
- Wire-up helper (`wireRuleEngineV2`) — lands under #395.
- Indexes beyond the orchestrator hot-path; analytics / admin indexes when they're actually needed.

## Surprises

(empty — fill in retroactively after the feature lands)
