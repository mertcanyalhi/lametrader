# Spec: state collection — profile binding + chart-annotation reader

- Status: implemented
- Touches: `core` (`packages/core/src/state-repository.types.ts`), `engine` (`packages/engine/src/state/*`, `packages/engine/src/rules/rule-orchestrator.ts`, `packages/engine/src/rules/state-action-executor.ts`, `packages/engine/src/rules/evaluation-context.{ts,types.ts}`, `packages/engine/src/rules/rule-evaluation-lookups.ts` if present, new `packages/engine/src/rules/symbol-state-events.ts`), `api` (`packages/api/src/controllers/state.controller.ts`), `cli` (`packages/cli/src/state.ts`).

## Goal

Partition the rules-engine state store by `profileId` so two profiles operating on the same symbol have isolated `state.*` namespaces — a write under profile A on `AAPL`'s `state.trend` is invisible to profile B.
Expose a thin read helper that returns the `StateSet` / `StateRemoved` entries from a symbol's existing `events[]`, so the chart can render state-change markers without a new collection.

## Acceptance criteria

Each bullet maps to exactly one test.

### `StateRepository` port + adapters (in-memory + Mongo)

- [ ] `setSymbolState(profileId, symbolId, key, value, ts)` writes the value and emits one `StateChangedEvent` with `profileId`, `scope: { kind: Symbol, symbolId }`, `prev: null`, `current: value`, `ts`.
- [ ] `getSymbolState(profileId, symbolId, key)` returns the value previously written by the same `profileId` and `null` for a different `profileId` with the same `symbolId` + `key`.
- [ ] `listSymbolState(profileId, symbolId)` returns only the keys written by that `profileId`.
- [ ] `removeSymbolState(profileId, symbolId, key, ts)` removes the key in that profile only, leaving the same `symbolId`+`key` intact under a different `profileId`, and emits a `StateChangedEvent` with `prev: <previous value>`, `current: null`, `profileId`.
- [ ] `setGlobalState(profileId, key, value, ts)` writes under the profile's global namespace and emits a `StateChangedEvent` with `scope: { kind: Global }`, `profileId`.
- [ ] `getGlobalState(profileId, key)` returns `null` for a different `profileId` with the same `key`.
- [ ] `listGlobalState(profileId)` returns only the keys written under that `profileId`.
- [ ] `removeGlobalState(profileId, key, ts)` removes only the profile's entry and emits a `StateChangedEvent` with `profileId`, `prev: <previous value>`, `current: null`.
- [ ] Mongo adapter's unique index is `(profileId, scope, symbolId, key)`; reads under the same `(scope, symbolId, key)` but different `profileId` resolve independently (covered by the shared contract suite).
- [ ] Mongo adapter on `ensureIndexes` drops every existing document that lacks a `profileId` field (wipe-and-rebuild migration; we never persisted profile-aware state before).

### Cascade through orchestrator

- [ ] `RuleOrchestrator` passes the firing rule's `profileId` to `executeStateAction`, which calls `state.setSymbolState(profileId, ...)` / `state.setGlobalState(profileId, ...)`.
- [ ] A state change written under profile A re-enters the engine as a `SymbolStateChanged` / `GlobalStateChanged` rule event carrying `profileId: A`, and the orchestrator filters cascaded candidate rules by that `profileId` so a profile-B rule on the same symbol does not fire.

### Evaluation lookups

- [ ] `EvaluationLookups.getSymbolState(profileId, symbolId, key)` and `getGlobalState(profileId, key)` accept `profileId` and return only that profile's value. The orchestrator threads the rule's `profileId` into the context.

### Chart-annotation reader

- [ ] `listSymbolStateEvents(symbol)` returns the subset of `symbol.events` whose `type` is `StateSet` or `StateRemoved`, in original order, with their full payloads (`ts`, `ruleId`, `symbolId`, `scope`, `key`, and `value` for `StateSet`).
- [ ] `listSymbolStateEvents(symbol)` returns `[]` when `symbol.events` is undefined or empty.

### API + CLI surface

- [ ] `GET /profiles/:profileId/state/global` returns the global state map for that profile.
- [ ] CLI `state list --profile <id> --global` returns the profile's global map; `state list --profile <id> --symbol <symbolId>` returns the profile's per-symbol map.
- [ ] CLI `state set`/`state remove` require `--profile <id>` and write under that profile only.

## End-to-end expectation

**Happy path** — `poll → rule fires → state write → cascade`:

1. Two profiles (`profA`, `profB`) each own one rule on the same watched symbol `AAPL`; both rules write `state.trend = up` on a price-cross condition.
2. A single live candle satisfies both rules' conditions, fed through the polling loop.
3. `profA`'s rule fires first; the state write produces a cascade event scoped to `profA`.
4. `profB`'s rule reads its own `state.trend` (still `null`) and fires its own write.
5. After the tick: `state.getSymbolState(profA, AAPL, 'trend') === { type: Enum, value: 'up' }` and likewise for `profB` — neither saw the other's write, and `Symbol.events[]` for `AAPL` contains two `StateSet` entries (one per `ruleId`).

**Critical failure mode** — `state.getSymbolState` and the cascade respect profile isolation even when both profiles write the *same* `(symbolId, key)` in the same tick; neither profile's downstream rule sees the other's value.

## Out of scope

- A separate platform-wide ("cross-profile") state tier.
  Decision: profile-scoped only; symmetric for symbol + global.
- A denormalized `state_history` collection.
  Decision: chart reads from `Symbol.events[]` (already populated per ADR 0012).
- Backfilling existing state docs under a "default" `profileId`.
  Decision: wipe-and-rebuild on startup.
- Web chart marker rendering (separate web milestone).
- Pre-bucketed candle-aligned timestamps on the chart reader — the chart can bucket at render time.
- Per-rule attribution beyond what's already on the entry (`ruleId` is enough).

## Surprises

_(Filled in retroactively after implementation.)_
