# 0014. State collection partitioned by `profileId`; chart annotations read from `Symbol.events[]`

- Status: accepted
- Date: 2026-06-27

## Context

The rule-engine state store (port `StateRepository`, see `specs/state-action-executor.spec.md` and ADR 0012) keys symbol-scoped entries by `(scope, symbolId, key)` and global-scope entries by `(scope, key)`.
A single Mongo `state` collection serves every profile.
Two gaps surfaced (issue #281):

1. **State is not bound to a profile.**
   Two profiles operating on the same watched symbol share one `state.trend` slot — profile B's read sees profile A's write.
   If profiles are isolated runtime contexts (and they are — `Rule.profileId` is the primary axis the orchestrator filters on, see ADR 0009), the shared key space is a correctness leak.

2. **No surface for chart state-change annotations.**
   The `state` collection holds only the latest `(value, updatedAt)` per key, so it can't render "trend flipped down→up at this candle" markers.
   But the full timeline already exists per ADR 0012: every `Set*State` / `Remove*State` action appends a `StateSet` / `StateRemoved` entry to both `Rule.events[]` and the affected `Symbol.events[]`.

The forking decisions:

- Where does the per-profile axis live — on every read/write call as a function parameter, or as ambient context resolved at call time?
- Is global state partitioned by profile too, or kept as a cross-profile namespace?
- For chart annotations, do we read `Symbol.events[]` (existing source of truth, no schema change) or denormalize into a `state_history` collection optimized for chart reads?
- What happens to existing `state` documents (pre-#281) — backfill them under a "default" profile or wipe and rebuild?

## Decision

**1. State is partitioned by `profileId` on every method of the `StateRepository` port.**
The port takes `profileId` as the first argument on every read/write (`getSymbolState(profileId, symbolId, key)`, `setGlobalState(profileId, key, value, ts)`, etc.), and `StateChangedEvent` carries `profileId` so the orchestrator's cascade subscription routes the resulting `SymbolStateChanged` / `GlobalStateChanged` rule events only to same-profile candidates.
Symbol-scoped and global state are partitioned **symmetrically** — no platform-wide tier.
The Mongo unique index becomes `(profileId, scope, symbolId, key)`; the in-memory adapter keys outer-most by `profileId`.

**2. The chart-annotation reader is a thin filter over `Symbol.events[]`.**
A pure helper `listSymbolStateEvents(symbol)` returns the `StateSet` / `StateRemoved` subset of the embedded events, in original order, with full payloads.
No new collection, no denormalization, no double-write — `Symbol.events[]` is already populated per ADR 0012.

**3. Pre-#281 documents are dropped on adapter startup.**
`MongoStateRepository.ensureIndexes` drops the legacy `scope_symbolId_key_unique` index, deletes every document lacking a `profileId` field, and creates the new `(profileId, scope, symbolId, key)` unique index.
We never persisted profile-aware state before, so the existing values can't be attributed; the engine repopulates the namespace on the next tick.

**4. `profileId` flows from the firing rule.**
The orchestrator threads `rule.profileId` into `buildEvaluationContext` (so `EvaluationLookups.getSymbolState` / `getGlobalState` resolve against the rule's namespace) and into `executeStateAction` (so writes land in the same namespace).
For cascaded re-entry, the orchestrator's `processOneEvent` picks the cascade event's `profileId` over the configured `getActiveProfileId` filter — keeping the cascade scoped to the originating profile.

**5. Boundary surfaces require `profileId` explicitly.**
The HTTP `GET /state/global` becomes `GET /profiles/:profileId/state/global` (sub-resource of profiles).
`GET /symbols/:id/state` keeps its path but takes a required `?profileId=...` query param.
The CLI `state list` / `state set` / `state remove` subcommands require a `--profile <id>` flag.

## Consequences

**Profile binding on the port.**

- `StateRepository` becomes a wider interface (one extra parameter on every method) but a cleaner contract — the namespace is a first-class argument, not an ambient context the caller has to remember.
  Tests are forced to name the profile explicitly, which makes mistakes obvious instead of subtle.
- The orchestrator gains one more value to pass through (`rule.profileId`), but it was already loading the rule to evaluate, so there's no new lookup.
- Cascade events carry `profileId` on `SymbolStateChangedEvent` / `GlobalStateChangedEvent`; downstream consumers of these rule events (none external today) would need to surface or ignore the field.

**Symmetric global partitioning.**

- "Global" now means "profile-global", not "platform-global".
  The mental model is uniform across symbol-scoped and global state — same partitioning rule for both — at the cost of giving up the cross-profile signaling use-case.
- We don't have a current need for cross-profile signaling, and adding it later as a separate "platform" tier remains an option (probably via a new repository, not a hidden third partitioning of the same one).

**Chart annotations from `Symbol.events[]`.**

- Zero schema change for the chart marker feature, and no second source of truth to keep in sync.
  The same single-document read that powers `/symbols/:id/rule-events` (per ADR 0012) powers `/symbols/:id/state-events` if/when we expose it.
- The embedded `events[]` document grows with state mutations, same as it already grows with `Fired` / `NotificationSent` entries.
  The growth shape is unchanged — this decision adds no new write load.
- Reads filter at render time (no candle-aligned bucketing in the helper).
  Cheap today; if the chart hits a perf wall we can pre-bucket, but the spec deliberately leaves that out of scope.

**Wipe-and-rebuild migration.**

- One fewer code path: no backfill script, no "default profile id" sentinel that lingers in the database forever.
- The cost is one tick of empty state after deployment.
  For the rule engine, that means trigger gates whose latch depends on state (none in the current set) would start fresh; the firing-state latch lives on `Rule` (per the 2026-06-27 amendment to ADR 0012) and is untouched by this migration.

**Boundary surfaces.**

- `GET /profiles/:profileId/state/global` mirrors the existing profile sub-resource pattern — RESTful and discoverable.
- The required `?profileId=` query on `/symbols/:id/state` is a breaking change for any caller that was previously hitting it without a profile.
  The route only landed in #145 and the only consumer is our own CLI, which is updated in the same change.
- The CLI `--profile <id>` flag is required for every subcommand.
  No implicit "active profile" from settings; if we add one later, the flag becomes optional with a default.

## Closes

#281.
