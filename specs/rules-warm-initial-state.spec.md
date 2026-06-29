# Spec: rules — warm `LiveEvaluationLookups` from persisted state on wire-up

- Status: draft
- Touches: `wireRuleEngine` (engine), `LiveEvaluationLookups.warmInitialState` (engine), `connectServices` caller (engine).

## Goal

After an engine restart, rules whose conditions read `SymbolStateRef` or `GlobalStateRef` currently see `null` for any key persisted by a previous engine process — the synchronous lookups mirror starts empty and only fills on the next `StateChangedEvent`.
`LiveEvaluationLookups.warmInitialState()` was defined to close that gap but is never called.
This fix makes `wireRuleEngine` build the warm snapshot from the persisted `StateRepository` (using the rule repository + watchlist to discover `(profileId, symbolId)` pairs) and call `warmInitialState()` before returning the wired engine.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] `warmInitialState` populates the per-symbol mirror so a subsequent `getSymbolState(profileId, symbolId, key)` returns the seeded value (regression for the symbol path).
- [ ] `warmInitialState` populates the per-global mirror so a subsequent `getGlobalState(profileId, key)` returns the seeded value (regression for the global path).
- [ ] `wireRuleEngine` returns a `Promise` whose resolved engine has the seeded symbol-state value already visible via `wired.lookups.getSymbolState(profileId, symbolId, key)` — without any `StateChangedEvent` firing first.
- [ ] `wireRuleEngine` discovers `profileId`s from `rules.list()` and `symbolId`s from `watchlist.list()`, so a seeded `(profileId, symbolId, key)` is warmed even when no rule directly references that symbol — verified by asserting the symbol-state key shows up on the lookups mirror after wiring.
- [ ] `wireRuleEngine` warms global-state values for each `profileId` discovered from `rules.list()`, verified by asserting the seeded global key shows up on the lookups mirror after wiring.
- [ ] When `rules.list()` returns no rules, `wireRuleEngine` still resolves cleanly (no seeded state to warm; the wired engine is usable).

## End-to-end expectation

Persist a symbol-state value via the `StateRepository`, then construct a fresh `wireRuleEngine` (simulating a restart), then fire a tick on a rule whose condition reads that state — the rule must fire under the seeded value (currently it does not because the mirror starts empty).

## Out of scope

- A new `listAll*` enumeration on `StateRepository` (the symbol/global state snapshot uses the existing `listSymbolState` / `listGlobalState` per `(profileId, symbolId)` pair derived from the rule repo + watchlist).
- Indicator state warming (the indicator cascade bridge's mirror is separate; not in the reported bug).
- A new architectural decision (no ADR — this fixes a wiring gap that was always intended per the existing "without this..." comment).

## Surprises

(filled retroactively)
