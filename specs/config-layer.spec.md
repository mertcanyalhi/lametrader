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

## Notification destinations sub-resource

Telegram destinations live alongside the scalar config in the same K/V store
under a new key `ConfigKey.TelegramDestinations`, holding a
`TelegramDestination[]` (last-write-wins on the whole array).

The `TelegramDestinationsService` is the only writer/reader; the scalar
`/config` endpoints are untouched and do not expose destinations.

### Storage choice

Destinations are stored as an array under a single K/V key rather than in
their own collection with a dedicated repository port + in-memory + Mongo
adapter + shared contract — the shape every other list resource
(`rules`, `profiles`, `watchlist`) uses.

The divergence is deliberate. Notification destinations are admin-edited,
hold 1–10 entries, see a handful of writes per day, and are reached for
from the same Settings page as the scalar `Config`. None of the reasons
the other list resources earn their own collection apply: no growth, no
indexed queries, no concurrent writers, no per-row ACL.

Trade-offs accepted:

- Array-level writes (no partial update) — fine at this rate.
- Last-write-wins concurrency — acceptable single-tenant; two admin saves
  racing pick a winner instead of a merge.
- Name uniqueness moves from a unique index to service-level validation
  (replace-or-append by `name` on every upsert).

In exchange: one fewer collection, port, adapter pair, and contract suite
per notification channel; admin settings live together in the API
(`/config`, `/config/notifications/*`) and the UI's Settings page; adding
a sibling channel is a new `ConfigKey` + sibling sub-route, not a new
storage layer.

### API (`/config/notifications/telegram`)

- `GET /config/notifications/telegram` — list `[{ name, chatId }]` (no bot tokens).
- `POST /config/notifications/telegram` — upsert `{ name, botToken, chatId }`; returns the summary.
- `DELETE /config/notifications/telegram/:name` — remove; **404** when absent.

### CLI (`lametrader config notifications telegram …`)

- `list` — same projection as the API.
- `set --name --bot-token --chat-id` — upsert.
- `delete --name` — remove.
- `test --destination --message` — send a one-off message through the wired `Notifier`.

## Out of scope

- Per-symbol / per-user config, config history/versioning, API auth,
  hot-reload/subscriptions, and any period values beyond the enum.
- Per-rule notification preferences (only the destinations book lives here).
- Slack or other notification adapters (the `/config/notifications/` shape is
  forward-compatible but no new channel is added in this spec).
