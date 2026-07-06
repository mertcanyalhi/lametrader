# Runtime indicator-instance registration

- Status: draft
- Touches: `IndicatorSeriesStore` (analytics/rules), `ProfileService` (analytics/services), `AnalyticsModule` wiring, `RuleEngineService`.

## Goal

Make a profile-attached indicator instance usable by the running rule engine the moment it is attached, without a process restart.

Today `IndicatorSeriesStore.register` is called exactly once, from `RuleEngineService.start()` at boot.
`ProfileService.addIndicator` / `replaceIndicator` / `removeIndicator` only persist the change, so a rule referencing a newly-attached instance resolves `EMPTY_SERIES` → `null` → never fires until the process restarts (#519).

The fix is Option A (push): promote `IndicatorSeriesStore` to a single instance shared by `RuleEngineService` and `ProfileService`, and have the profile mutations push registrations into it — mirroring the existing `ProfileService` → `rules` delete-cascade port.

## Acceptance criteria

Each bullet maps to exactly one test.

### `IndicatorSeriesStore`

- [ ] `unregister(instanceId)` drops a registered config so `series` for that instance returns an empty view again.

### `ProfileService` → store cascade

Wired to the **same** store instance production supplies, with no boot-time registration having run:

- [ ] `addIndicator` registers the new instance's config, so `store.series(...)` for it resolves to a non-empty computed view (the #519 repro — was `EMPTY_SERIES`).
- [ ] `replaceIndicator` re-registers the instance's config with the replacement's inputs, so `store.series(...)` reflects the new inputs (overwrites the prior config).
- [ ] `removeIndicator` unregisters the instance's config, so `store.series(...)` for it returns an empty view.

## End-to-end expectation

Mirrors `indicator-operand-fire.e2e-spec.ts`, but the instance is attached **after** the engine starts, through the HTTP API:

- Boot the app, watch a symbol, create an enabled profile, `start()` the engine (no instance attached yet).
- `POST /profiles/:id/indicators` an `sma` instance; create a rule whose `IndicatorRef` targets the returned instance id.
- Feed a closing bar that lifts SMA above the literal → the rule fires (`Fired` + `StateSet`) — no restart.
- Critical failure mode: `DELETE /profiles/:id/indicators/:instanceId` then feed a lifting bar → the rule does **not** fire (the instance was unregistered).

## Out of scope

- Option B (lazy pull of unregistered configs from the profile repo in `series()`) — rejected; `series()` stays a synchronous `Map` lookup and the store never learns about the profile repo.
- The profile enable/disable → bulk re-registration path — untouched (#519 is only the per-instance mutation path).
- Registration remains unconditional (even for a disabled profile's instance): the store is a pure config registry; whether a rule fires is decided elsewhere.

## Surprises

Empty.
