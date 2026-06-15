# Spec: profile CRUD

- Status: approved
- Touches:
  - `core` — `Profile` / `ProfileScope` types, `ProfileRepository` port, `ProfileError` / `ProfileNotFoundError` / `ProfileConflictError`, `parseProfileScope` / `parseProfileFields` / `mergeProfileFields`.
  - `engine` — `ProfileService`, `InMemoryProfileRepository`, `MongoProfileRepository`, shared `ProfileRepository` contract; `SymbolService.remove` cascade; `connectServices` wiring.
  - `api` — `profiles.controller` + `profile.schema`; error mappings.
  - `cli` — `profile` command group.

## Goal

A **Profile** is a named, enable/disable-able template scoped to watched symbols — either all of them (the default) or an explicit subset.
This delivers its full CRUD lifecycle over REST and CLI plus the scope rules.
It will later hold indicators and actions, which are out of scope here (the container only).

## Domain model

- `ProfileScope` enum: `All = 'all'`, `Symbols = 'symbols'`.
- `ProfileScopeSpec` (discriminated on `type`): `{ type: All }` or `{ type: Symbols, symbolIds: string[] }`.
- `Profile`: `{ id, name, description, enabled, scope, createdAt, updatedAt }` (`createdAt`/`updatedAt` epoch ms).
  `id` is a generated nanoid.
- `ProfileRepository` port: `list()`, `get(id)`, `save(profile)` (upsert by id), `remove(id)` (idempotent no-op when absent).
- `ProfileService(profiles, watchlist, { newId?, now? })` — `newId` defaults to nanoid, `now` to `Date.now`.
  Both are injectable for tests.

Scope rules:

- `symbolIds` in a `Symbols` scope must be **currently watched** (else a client error).
- An **empty** subset on a direct write **normalizes to `All`**.
- On **symbol removal**, the id is pruned from every profile's subset.
  A profile whose subset becomes empty is **disabled** and left `Symbols`-scoped (not widened).

## Acceptance criteria

Domain (`core`):

- [ ] `parseProfileScope({ type: 'symbols', symbolIds: ['crypto:BTCUSDT'] })` returns that symbols scope unchanged.
- [ ] `parseProfileScope({ type: 'symbols', symbolIds: [] })` normalizes to `{ type: 'all' }`.
- [ ] `parseProfileScope({ type: 'all' })` returns `{ type: 'all' }`.
- [ ] `parseProfileScope` throws `ProfileError` on an unknown `type` or non-string `symbolIds` entries.
- [ ] `parseProfileFields` applies defaults (description `''`, enabled `true`, scope `{ type: 'all' }`) and rejects a blank `name` with `ProfileError`.
- [ ] `mergeProfileFields` overlays a patch and revalidates: `enabled: false` applies; omitted fields keep the current value.

Application (`ProfileService`; fake `ProfileRepository` + fake `WatchlistRepository`, injected `newId` / `now`):

- [ ] `create` builds a profile with the generated id, equal `createdAt`/`updatedAt`, and applied defaults, and persists it (full-payload).
- [ ] `create` throws `ProfileConflictError` on a duplicate name and persists nothing.
- [ ] `create` rejects a symbols scope containing an unwatched id with `ProfileError` (persists nothing).
- [ ] `get` returns the stored profile; an unknown id throws `ProfileNotFoundError`.
- [ ] `replace` fully replaces mutable fields, preserving `id` + `createdAt` and bumping `updatedAt`.
- [ ] `update` patches only the provided fields (e.g. `enabled: false`), keeping the rest.
- [ ] `remove` deletes the profile; an unknown id throws `ProfileNotFoundError`.
- [ ] `pruneSymbol` removes an id from every profile's subset; a profile left with an empty subset becomes `enabled: false` and stays `Symbols`-scoped.

Persistence contract (`ProfileRepository`, in-memory in unit / Mongo in e2e):

- [ ] save→get→list round-trips; `save` replaces by id; `get` returns `null` for an unknown id; `remove` deletes and is a no-op for an unknown id.

CLI (`runProfiles`, against a real `ProfileService` over in-memory repos):

- [ ] `create` / `list` / `update` / `delete` drive the service and print the result; an unknown subcommand errors.

## End-to-end expectation

API e2e over real Mongo (Testcontainers), with a watched symbol seeded so scope validation has something to check:

- Happy path: `POST /profiles` (201) → `GET /profiles` (200) → `GET /profiles/:id` (200) → `PATCH` `{ enabled: false }` (200) → `PUT` replacing scope with a watched subset (200) → `DELETE` (204) → list is empty.
- Critical failure mode: a second `POST` with a duplicate name → **409**, and the store still holds exactly the first profile.

## Out of scope

- Attaching indicators / actions to a profile (later issues) and the runtime that reads `enabled` / `scope`.
- A profile-scoped indicators sub-resource.
- Authentication / multi-user ownership of profiles.
