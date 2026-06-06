# Spec: engine configuration layer (MongoDB-backed)

- Status: approved
- Touches: `core` (Config entity, `Period` enum, `ConfigRepository` port, validation),
  `engine` (`ConfigService` use-case + `MongoConfigRepository` driven adapter), `cli`
  and `api` (driving adapters to view/change config).

## Goal

A single, persisted, global configuration for the platform, stored in MongoDB and
read/written through a port. Two fields for now: supported `periods` and a
`defaultPeriod`. Viewable and changeable from the CLI and a REST API.

## Domain model

- `Period` is an **enum** of supported period strings: `1m, 5m, 15m, 30m, 1h, 4h,
  1d, 1w` (the values common across symbols; only these are accepted).
- `Config = { periods: Period[]; defaultPeriod: Period }`.
- **Defaults** (nothing persisted yet): `periods = [1h, 1d]`, `defaultPeriod = 1d`.
- A **singleton** document (one global config), not per-symbol or per-user.
- `PUT` semantics = full replace (both fields required); `PATCH` = partial merge over
  the current config. Both validate the *resulting* config.

## Acceptance criteria (each → one unit test, full-payload `toEqual`)

Domain (`core`):

- [ ] `defaultConfig()` returns `{ periods: [Period.OneHour, Period.OneDay], defaultPeriod: Period.OneDay }`.
- [ ] `parseConfig` accepts a valid input and returns the full normalized `Config`.
- [ ] `parseConfig` throws on a period not in the enum (e.g. `"2h"`).
- [ ] `parseConfig` throws on an empty `periods` list.
- [ ] `parseConfig` throws on duplicate periods.
- [ ] `parseConfig` throws when `defaultPeriod` is not in `periods`.
- [ ] `mergeConfig(current, { defaultPeriod })` returns current with only `defaultPeriod` changed.
- [ ] `mergeConfig(current, { periods })` returns current with only `periods` changed (and revalidated).
- [ ] `mergeConfig` throws when the merged result is invalid (e.g. new periods drop the current default).

Application (`engine`, against a fake in-memory `ConfigRepository`):

- [ ] `get()` returns `defaultConfig()` when the repository is empty.
- [ ] `get()` returns the persisted config when one exists.
- [ ] `replace(input)` validates, persists, and returns the stored config (PUT).
- [ ] `patch(input)` merges over current, persists, and returns the result (PATCH).
- [ ] `replace`/`patch` with an invalid payload throw and persist nothing.

Driving adapters:

- [ ] CLI `config get` prints the current config as JSON.
- [ ] CLI `config set --periods 1h,1d --default-period 1d` persists and echoes the result.
- [ ] API `GET /config` → 200 with the current config.
- [ ] API `PUT /config` with a valid body → 200 with the stored config; invalid → 400.
- [ ] API `PATCH /config` with a partial body → 200 with the merged config; invalid → 400.

## End-to-end expectation

With an ephemeral MongoDB (Testcontainers): write a config through
`MongoConfigRepository`, read it back through a fresh repository instance, and assert
it round-trips. Critical failure mode: an invalid update is rejected and the
previously persisted value is unchanged.

## Out of scope

- Per-symbol / per-user config, config history/versioning, API auth,
  hot-reload/subscriptions, and any period values beyond the enum.
