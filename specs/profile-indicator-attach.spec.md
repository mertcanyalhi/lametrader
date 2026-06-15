# Spec: attach indicators to a profile

- Status: approved
- Touches:
  - `core` — `IndicatorInstance` type embedded on `Profile`; `IndicatorInstanceNotFoundError` (HTTP 404); re-exports.
  - `engine` — `ProfileService` gains an `IndicatorRegistry` dependency and five instance methods (`listIndicators` / `getIndicator` / `addIndicator` / `replaceIndicator` / `removeIndicator`); `MongoProfileRepository` round-trips the new `indicators` field; `defaultIndicators()` is wired into `connectServices`.
  - `api` — sub-resource routes under the profiles controller (`GET/POST /profiles/:id/indicators`, `GET/PUT/DELETE /profiles/:id/indicators/:instanceId`); `IndicatorInstanceNotFoundError` mapped to 404 in `app.ts`; new schemas; `app.types.ts` continues to feed `indicators` through DI.
  - `cli` — `profile indicators` sub-group (`list` / `add` / `update` / `remove`); routes through the same `ProfileService` constructed by `connectServices` plus `defaultIndicators()`.
  - READMEs — `api` and `cli` Profiles sections gain the new sub-surface.

## Goal

Let a user **attach a previously defined indicator to a profile**, configuring its inputs once.
An attached indicator is computed for the profile's symbols across all of each symbol's watched periods — **no period is chosen or stored here**.
This issue delivers the profile ⇄ indicator-instance management + validation; the actual computing/serving of results, chart rendering, and actions are downstream.

## Domain model

`IndicatorInstance` (embedded in `Profile.indicators[]`):

- `id` — server-generated nanoid, so an action can address *this* attachment.
- `indicatorKey` — which definition, looked up in the `IndicatorRegistry`.
- `version` — the definition version the inputs were validated against (recorded from `definition.version` at attach time).
- `inputs` — concrete values, validated against the definition's `inputs` descriptors via `validateIndicatorInputs`.
- `label?` — optional alias (e.g. to tell two moving averages of different lengths apart).

`Profile` gains `indicators: IndicatorInstance[]` (defaults to `[]` on `create`).
The new field lives **outside `ProfileFields`** — profile-level `PUT` / `PATCH` preserve the current `indicators` array (sub-resource routes are the only way to add/update/remove instances).

**Period model — nothing stored.**
An instance carries **no period**.
At compute time (a later issue), the indicator runs at **each of the symbol's watched periods** (`WatchedSymbol.periods`).
The watchlist remains the single owner of the period decision.

**Asset-class mismatch — skip at compute.**
Attaching is always allowed; an indicator is simply **not computed** for a symbol whose `type` isn't in the definition's `appliesTo`.
No reject-at-attach (scope drifts — `All` makes "current scope" a moving target).

**Validation at attach / replace:**

- `indicatorKey` must be a string; lookup misses throw `IndicatorError` (→ 400).
- `inputs` validated by `validateIndicatorInputs(definition, raw)`; failures throw `IndicatorError` (→ 400).
- `label` must be a string when present.

**Errors:**

- `IndicatorInstanceNotFoundError` — distinct domain error for unknown `instanceId` lookups, mapped to HTTP 404 (mirrors `SymbolNotFoundError` / `ProfileNotFoundError` / `IndicatorNotFoundError`).

## API (RESTful sub-resources over the embedded array)

- `GET /profiles/:id/indicators` → **200** list of instances; **404** unknown profile.
- `POST /profiles/:id/indicators` → **201** created instance; **400** unknown `indicatorKey` / invalid `inputs`; **404** unknown profile.
- `GET /profiles/:id/indicators/:instanceId` → **200**; **404** unknown profile or instance.
- `PUT /profiles/:id/indicators/:instanceId` → **200** (full-replace; same validation as `POST`); **400**; **404**.
- `DELETE /profiles/:id/indicators/:instanceId` → **204**; **404**.

## CLI

`lametrader profile indicators <subcommand>`:

- **`list <profileId>`** — print the profile's instances as JSON.
- **`add <profileId> --indicator-key <k> [--label <s>] [--inputs <json>]`** — attach; print the created instance.
- **`update <profileId> <instanceId> --indicator-key <k> [--label <s>] [--inputs <json>]`** — full-replace; print the updated instance.
- **`remove <profileId> <instanceId>`** — detach.

## Acceptance criteria

Domain (`core`):

- [ ] An `IndicatorInstance` type carries `{ id, indicatorKey, version, inputs, label? }` — exported and reachable from `@lametrader/core`.
- [ ] `IndicatorInstanceNotFoundError` is a distinct error class exported from `@lametrader/core` (mapped to 404 by the API).

Application (`ProfileService`, with a stubbed `IndicatorRegistry` containing the moving-average module):

- [ ] `ProfileService.create({...})` initializes `indicators: []` on the persisted profile (full-payload).
- [ ] `replace` and `update` preserve the current `indicators` array (mutating other fields doesn't drop attached instances).
- [ ] `addIndicator(profileId, { indicatorKey: 'sma' })` appends an instance with the generated id, `version: 1`, defaulted inputs (`length: 14`, `source: 'close'`), no label; the saved profile's `indicators` length is exactly 1 (full-payload).
- [ ] `addIndicator(profileId, { indicatorKey: 'sma', inputs: { length: 5 }, label: 'Fast' })` validates + records the explicit inputs, the override `length: 5`, and the label (full-payload).
- [ ] `addIndicator(profileId, { indicatorKey: 'bogus' })` throws `IndicatorError` and persists nothing.
- [ ] `addIndicator(profileId, { indicatorKey: 'sma', inputs: { length: 0 } })` throws `IndicatorError` (invalid input range) and persists nothing.
- [ ] `addIndicator('unknown-profile', { indicatorKey: 'sma' })` throws `ProfileNotFoundError`.
- [ ] `listIndicators(profileId)` returns the embedded array.
- [ ] `getIndicator(profileId, instanceId)` returns the matching instance; an unknown instance throws `IndicatorInstanceNotFoundError`.
- [ ] `replaceIndicator(profileId, instanceId, { indicatorKey: 'sma', inputs: { length: 21 } })` overwrites the matching instance with new inputs (and a new `version` from the registry); the surrounding array is unchanged in length and order.
- [ ] `removeIndicator(profileId, instanceId)` removes the matching instance; an unknown instance throws `IndicatorInstanceNotFoundError`.

API (`profiles.controller.ts`):

- [ ] `GET /profiles/:id/indicators` → 200 with the array of instances (full-payload).
- [ ] `POST /profiles/:id/indicators` with a valid body → 201 with the new instance; an unknown `indicatorKey` or invalid `inputs` → 400 with `{ error }`; unknown profile id → 404.
- [ ] `GET /profiles/:id/indicators/:instanceId` → 200 with the matching instance; unknown instance → 404.
- [ ] `PUT /profiles/:id/indicators/:instanceId` → 200 with the replaced instance.
- [ ] `DELETE /profiles/:id/indicators/:instanceId` → 204; second delete → 404.

CLI (`runProfiles indicators <subcommand>`):

- [ ] `list <profileId>` prints the embedded array as JSON.
- [ ] `add <profileId> --indicator-key sma --inputs '{"length":5}' --label Fast` prints the new instance.
- [ ] `update <profileId> <instanceId> --indicator-key sma --inputs '{"length":21}'` prints the updated instance.
- [ ] `remove <profileId> <instanceId>` prints `removed <instanceId>`.
- [ ] An unknown subcommand throws.

## End-to-end expectation

Extend `packages/api/tests/e2e/profiles.e2e.test.ts` with a sub-resource pass over **real** Mongo + the real `defaultIndicators()` registry:

- Happy path: `POST /profiles` to create a profile → `POST /profiles/:id/indicators` (with valid `sma` body) returns 201 with the instance → `GET /profiles/:id/indicators` returns `[instance]` → `PUT` replaces it with different inputs (asserted by full-payload diff) → `DELETE` returns 204 → final `GET …/indicators` returns `[]`.
- Critical failure mode: `POST` with `indicatorKey: 'bogus'` returns **400**, and the profile's `indicators` array is still empty (no partial write).

## Out of scope

- Computing/serving an attached indicator's results over a symbol's candles (the `(symbol, period)` matrix) — that's #16.
- The monitoring loop and actions.
- Chart rendering of attached instances.
- A profile-scoped indicators *compute* route (`GET /profiles/:id/indicators/:instanceId/results`) — the client composes that from this issue's instance lookup + #16's compute endpoint.
- Migrating stored instances when an indicator's `version` bumps.

## Surprises

(Filled in retroactively if anything bites — empty by default.)
