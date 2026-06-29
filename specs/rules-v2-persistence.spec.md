# rules-v2 persistence

Greenfield persistence for v2 rules (#388) and their event log.
A separate Mongo collection from v1 (`rules_v2` vs `rules`), so both engines coexist behind the feature flag without schema entanglement (per ADR 0016).

## Scope

- `rules_v2` Mongo collection storing the v2 `Rule` shape from #388.
- v2 `RuleRepository` port (CRUD + `listEnabledForSymbol` semantics ported from v1).
- v2 `EventLog` port — per-rule + per-symbol `RuleEventEntry` arrays.
- In-memory + Mongo adapters for both ports.
- Shared contract suite exercised against both adapters (ports + adapters discipline per ADR 0001).
- Hot-path indexes on the orchestrator's read pattern.

## Design

### Collections + documents

The v2 rule document lives in a brand-new `rules_v2` collection keyed by `Rule.id` as `_id`.
v1's `rules` collection is untouched; both engines read and write their own data.

The v2 event log writes:

- **Rule events** to a `events` field on the matching `rules_v2.{ruleId}` document (`$push` append).
- **Symbol events** to a brand-new `events_v2` field on the matching `watchlist.{symbolId}` document (`$push` append).
  The `events_v2` field is distinct from v1's `events` field on the same document, so the two engines never overwrite each other's symbol-event log.

Rule events live on the v2 rule's own document (clean rename); symbol events land on `watchlist.events_v2` (parallel field to v1's `watchlist.events`).
The two-write fan-out is not atomic — an interleaved failure may leave one side missing an entry.
Acceptable for an events log (occasional gaps don't change correctness) and matches v1's behavior.

### Repository surface

`RulesV2.RuleRepository` is extended from the current minimal read/save surface to full CRUD parity with v1's repo:

- `list()` — all rules across all profiles, unordered.
- `listForSymbol(symbolId, profileId?)` — `Symbol(symbolId)` + `Symbols([..symbolId..])` + `AllSymbols` scope matches; `null` symbol returns only `AllSymbols`; optional `profileId` further restricts.
- `listEnabledForSymbol(symbolId, profileId?)` — `listForSymbol` filtered to `enabled: true` rules whose parent profile is also `enabled: true`.
- `get(id)` — one rule by id, or `null` if absent.
- `save(rule)` — upsert by id (re-saving an id replaces it).
- `remove(id)` — idempotent delete by id.
- `removeForProfile(profileId)` — bulk delete by parent profile; returns the ids that were removed.

The profile-enabled filter consults an optional injected `ProfileRepository` (`@lametrader/core`).
When no profile repo is provided (e.g. unit tier without profile data), every profile reads as enabled — same back-compat carve-out v1's repo uses.
Profiles are shared between v1 and v2 — there's no separate v2 `Profile` shape in this slice.

### `listEnabledForSymbol` ordering

The dispatcher consumes the result without re-sorting and v1's repo returns insertion order, so the contract does not pin a deterministic order.
Tests assert set membership only.

### Event log surface

`RulesV2.EventLog` is unchanged from #393's port:

- `appendRuleEvent(ruleId, entry)` / `appendSymbolEvent(symbolId, entry)` with `firedAt` stamping if absent.
- `ruleEvents(ruleId)` / `symbolEvents(symbolId)` returning entries in append order.
- `onAppend(listener)` invoked AFTER each successful write with the stamped entry and a discriminated `target`.

### Indexes

`MongoRuleRepository.ensureIndexes()` creates:

- `{ profileId: 1, order: 1 }` — supports per-profile reads sorted by `order`.
- `{ 'scope.symbolId': 1 }` — supports `Symbol`-scope `listForSymbol`.

These mirror v1's index choices; the orchestrator's hot path is `listEnabledForSymbol(symbolId[, profileId])` which is served by a `find` over these projections.

### Contract suite

Lives at `packages/engine/src/rules-v2/persistence/testing/`:

- `rule-repository.contract.ts` — every CRUD method, scope variant (`Symbol` / `Symbols` / `AllSymbols`), profile filter, enabled filter, profile-enabled filter, and a round-trip for every Trigger / Action / LeafConditionFamily / RuleScope variant.
- `event-log.contract.ts` — `appendRuleEvent` / `appendSymbolEvent` round-trip for every `RuleEventEntry` type, `onAppend` listener fan-out, `firedAt` stamping semantics.

Run against the in-memory adapters in the unit tier and the Mongo adapters in the e2e tier (Testcontainers Mongo, ADR 0001).

## Acceptance criteria

- A v2 `Rule` containing each Trigger variant (`EveryTime` / `Once` / `OncePerBar` / `OncePerBarOpen` / `OncePerBarClose` / `OncePerInterval`) round-trips through Mongo and back with full-payload equality.
- A v2 `Rule` containing each `RuleScope` variant (`Symbol` / `Symbols` / `AllSymbols`) round-trips through Mongo and back with full-payload equality.
- A v2 `Rule` containing each `Action` variant (`Notification` / `SetSymbolState` / `SetGlobalState` / `RemoveSymbolState` / `RemoveGlobalState`) round-trips through Mongo and back with full-payload equality.
- A v2 `Rule` containing each `LeafConditionFamily` (`Comparison` / `Crossing` / `Channel` / `Moving` / `State`) inside an `And`/`Or` tree round-trips through Mongo and back with full-payload equality.
- Each `RuleEventEntry` variant (`Fired` / `NotificationSent` / `StateSet` / `StateRemoved` / `Error` / `CycleOverflow`) appended to the Mongo event log reads back via `ruleEvents` and `symbolEvents` with full-payload equality.
- `listEnabledForSymbol(symbolId)` excludes a rule whose own `enabled` flag is `false`.
- `listEnabledForSymbol(symbolId)` excludes a rule whose parent profile's `enabled` flag is `false` (when a `ProfileRepository` is injected).
- `listEnabledForSymbol(symbolId, profileId)` further restricts results to rules under that profile.
- `listEnabledForSymbol(null)` returns only `AllSymbols`-scoped enabled rules (used by the orchestrator's symbol-less fan-out path).
- `listForSymbol(symbolId)` returns `Symbol`/`Symbols`-scoped rules matching the id plus every `AllSymbols`-scoped rule.
- `removeForProfile(profileId)` deletes every rule under the given profile and returns the ids that were removed.
- The Mongo `RuleRepository` and `EventLog` both pass the shared contract suite end-to-end against a Testcontainers Mongo.
- The in-memory `RuleRepository` and `EventLog` both pass the same shared contract suite in the unit tier.
- After writing v2 rules to `rules_v2` and reading back v1 rules from `rules`, v1's `rules` collection is untouched (a coexistence test exercises both engines side-by-side on one Mongo instance).
- Symbol events appended via the v2 event log land on `watchlist.events_v2` and do NOT touch `watchlist.events` (v1's symbol-event field).
- `MongoRuleRepository.ensureIndexes()` is idempotent and creates indexes on `(profileId, order)` and `(scope.symbolId)`.

## Out of scope

- A v2 `ProfileRepository` — v2 reuses v1's profile types and adapter for the `profile.enabled` filter.
- Migration of v1 rules into `rules_v2` — per ADR 0016 the cutover is manual by the maintainer.
- Per-rule event-log retention or pagination — v1 keeps its full event array on the document and v2 follows suit.
