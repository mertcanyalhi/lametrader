# Spec: Enabled-rule lookup hot-path — per-tick dedupe, batched profile filter, indexed scope query

- Status: draft
- Touches: `RuleOrchestrator` (application), `TriggerDispatcher` (application), `InMemoryRuleRepository` + `MongoRuleRepository` (driven adapters)

## Goal

Cut the redundant Mongo work the rules engine does looking up enabled rules on the hot path (issue #461), without changing any observable firing behaviour.
The v2 engine already routes events to relevant rules (`routes()` + `referencesSlot()`) and no longer does an unconditional per-rule write, so this spec closes only the three lookup-cost gaps that survive: repeated identical rule-list queries within one tick, an N+1 profile lookup per query, and an unindexed scope query.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] Within one `RuleOrchestrator.process` tick, two cascade events resolving to the same `(symbolId, profileId)` pair issue exactly one `listEnabledForSymbol` query for that pair (per-tick cache), asserted via a counting `RuleRepository`.
- [ ] A `TickRuleCache` returns the same rules for a repeated `(symbolId, profileId)` key while querying its source once, and queries the source again for a different key.
- [ ] `listEnabledForSymbol` resolving two enabled rules that share a profile queries the injected `ProfileRepository` at most once (no per-profile N+1), asserted via a counting `ProfileRepository` against `InMemoryRuleRepository`.
- [ ] `MongoRuleRepository.ensureIndexes` creates indexes whose keys cover every `listForSymbol` `$or` branch: `{ 'scope.kind': 1, 'scope.symbolId': 1 }` and `{ 'scope.kind': 1, 'scope.symbolIds': 1 }` (index-shape assertion).
- [ ] The existing `RuleRepository` contract stays green for both adapters (profile-enabled filtering results unchanged after batching).

## End-to-end expectation

Rules e2e: driving a tick whose fired rule mutates two symbol-state keys on the same profile (two same-pair cascades) still produces the same event log as before, and the instrumented repository records exactly one `listEnabledForSymbol` call for that `(symbolId, profileId)` pair.
Critical failure mode already covered by the contract suite: a `Once` rule claimed mid-tick is not re-fired even though the cached list still contains it (the atomic `claimOnceFire` loses on the second attempt).

## Out of scope

- Any new "condition-tree → event-kind set" function in `core`: routing already exists via `routes()` (trigger→event kind + period) and `referencesSlot()` (cascade→operand slot), so adding one would duplicate working code.
- Caching across ticks / the per-symbol serializer chain, and any cache invalidation hooks: per-tick lifetime is enough and needs no invalidation because the `Once` atomic claim already suppresses a stale re-fire.
- Changing `OncePerBar` / `OncePerInterval` gate semantics or period handling.

## Surprises

(none yet)
