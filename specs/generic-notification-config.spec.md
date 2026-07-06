# Spec: generic notification configurations

- Status: implemented
- Touches:
  - `core` — replaces the Telegram-specific notification types with a generic notification-config shape (`packages/core/src/types/notifications/notification-config.types.ts`), and renames `ConfigKey.TelegramDestinations` → `ConfigKey.Notifications`.
  - `server` (`@lametrader/backend`, `src/common/`) — the `NotificationConfigsService` (id-keyed CRUD over the shared config K/V store), the generic `/config/notifications` controller, the request/response DTOs, the domain errors, and the notifier's lookup port.
  - `web` (`@lametrader/ui`) — the Settings page restructured into **General** / **Notifications** tabs, a generic notifications table + create/edit/delete dialogs, the query hooks, and the rule editor's destination dropdown.

## Goal

Replace the Telegram-specific notification configuration (`/config/notifications/telegram`, keyed by `name`) with a generic, RESTful `/config/notifications` resource keyed by a stable `id`, carrying a `notificationType` discriminator so more channels can be added later behind one common shape.
Telegram stays the only channel today; the genericism is the *contract* (routes, discriminator, id identity), not a speculative multi-channel validation framework.

## Domain model

- A notification config has a common base `{ id, notificationType, name }` plus type-specific fields.
  For Telegram: `{ …, botToken, chatId }`.
- `notificationType` reuses the existing `NotificationChannel` enum (value `telegram`) — the same vocabulary the rule engine's `NotificationAction.channel` already uses.
- `id` is a stable server-generated identity (`crypto.randomUUID()`), immutable, used by the REST routes.
- `name` stays the **rule-facing** identifier: rules' `NotifyTelegram` action references a destination by `name`, and the notifier resolves by name — so `name` remains unique across configs, and the rule engine is untouched.
- `botToken` is sensitive: **write-only**, never listed or echoed back on any read.
- Storage: a single `NotificationConfig[]` under `ConfigKey.Notifications` in the shared config K/V store (last-write-wins on the array), unchanged from the previous storage strategy (see `config-layer.spec.md`).
  No existing data to migrate (the store starts empty).

## Acceptance criteria (each → one test, full-payload `toEqual`)

Server — `NotificationConfigsService` (against an in-memory `ConfigRepository`):

- [ ] `list()` returns `[]` when nothing is stored.
- [ ] `create()` assigns an id, trims fields, persists, and returns the view `{ id, notificationType, name, chatId }` (no `botToken`).
- [ ] `create()` rejects a blank `name` / `botToken` / `chatId` with `NotificationConfigError`.
- [ ] `create()` rejects an over-length `name` with `NotificationConfigError`.
- [ ] `create()` rejects a duplicate `name` with `NotificationConfigConflictError`.
- [ ] `get(id)` returns the view (no `botToken`); an unknown id throws `NotificationConfigNotFoundError`.
- [ ] `update(id, patch)` merges the given fields, persists, and returns the view; an omitted `botToken` keeps the stored one.
- [ ] `update()` renaming to a name another config already holds throws `NotificationConfigConflictError`.
- [ ] `update()` / `remove()` on an unknown id throws `NotificationConfigNotFoundError`.
- [ ] `remove(id)` deletes the config.
- [ ] `findByName(name)` returns the full Telegram config (incl. `botToken`) for the notifier; an unknown name returns `null`.
- [ ] persists the array under `ConfigKey.Notifications`; a corrupt stored value throws `NotificationConfigError`.

Server — HTTP contract (`/config/notifications`, real pipe + filter, in-memory store):

- [ ] `POST` → **201** with the view; a duplicate name → **409**; a whitespace-only name → domain **400** `{ error }`; an empty name → validation **400** `{ error, fields:[name] }`; an unknown `notificationType` → validation **400**.
- [ ] `GET` → **200** list of summaries `{ id, notificationType, name }` (no `botToken`, no `chatId`).
- [ ] `GET /:id` → **200** view; an unknown id → **404**.
- [ ] `PATCH /:id` → **200** updated view; an unknown id → **404**; a body carrying `notificationType` → **400** (the type is immutable, not a PATCH-able field).
- [ ] `DELETE /:id` → **204**; a second delete → **404**.

Server — notifier (`TelegramNotifier`, retained behaviour over the new lookup):

- [ ] Resolves a config by name and POSTs to the Bot API; unknown name → `UnknownDestinationError`; non-2xx / transport failure → `TelegramSendError` (behaviour unchanged from the old destinations service).

Web — hooks (`lib/hooks/notifications.ts`, jsdom + fake `fetch`):

- [ ] `useNotifications()` GETs `/api/config/notifications` → summaries.
- [ ] `useNotification(id)` GETs `/api/config/notifications/:id` → the view.
- [ ] `useCreateNotification()` POSTs the JSON body to `/api/config/notifications`.
- [ ] `useUpdateNotification(id)` PATCHes `/api/config/notifications/:id`.
- [ ] `useDeleteNotification(id)` DELETEs `/api/config/notifications/:id`.

Web — schema (`lib/notification-config-schema.ts`):

- [ ] the create schema resolves a valid payload and flags a blank `name` / `botToken` / `chatId`.
- [ ] the edit schema treats `botToken` as optional (blank is valid) and flags a blank `name` / `chatId`.

Web — Settings page + Notifications section:

- [ ] the Settings page renders **General** and **Notifications** tabs; General is active by default and shows the config form.
- [ ] activating the Notifications tab shows the notifications table (**Notification type / Name / Actions** columns), or the "No notifications configured." empty state.
- [ ] the Add dialog submits a create (`POST`) and surfaces a success toast; a blank form flags the fields and issues no request.
- [ ] the Edit dialog opens prefilled (name + chat id from `GET /:id`) and submits an update (`PATCH`).
- [ ] the Delete confirm issues a delete (`DELETE`).

Web — rule editor:

- [ ] the notification action's destination dropdown lists the Telegram configs' names from `GET /config/notifications` (rules still pick a destination by name).

## End-to-end expectation

Server e2e (real Mongo, Testcontainers): `POST /config/notifications` creates a Telegram config (**201**); a fresh app connection reads it back via `GET /config/notifications` (summary) and `GET /config/notifications/:id` (view) — proving the `ConfigKey.Notifications` key persists; `PATCH` updates it; `DELETE` removes it and a second `DELETE` → **404**.
Docs e2e: the OpenAPI `/docs/json` paths include `/config/notifications` (and no longer the `/telegram` route).

Critical failure mode: `DELETE /config/notifications/:id` for an unknown id returns **404** (not a silent 204), and `PATCH` carrying `notificationType` is rejected **400** (the discriminator is immutable).

There is no browser e2e for the Settings page (consistent with `web-settings-page.spec.md`); the jsdom component tests pin every observable UI behaviour above.

## Out of scope

- Per-channel validation dispatch / a notification-adapter registry — only Telegram exists; the create DTO is a flat Telegram-shaped body gated by `notificationType` (`// Lazy:` marked), and a discriminated `@Type` DTO lands with the **second** channel.
- Migrating existing data — the store starts empty (confirmed with the author); the id-keyed shape is written fresh.
- Per-rule notification preferences, Slack/email/webhook channels, config history/versioning, API auth.
- The vestigial `TELEGRAM_DESTINATIONS` env var (parsed at boot, never consumed at runtime) is **removed** here — it referenced the deleted `TelegramDestination` type and its `{ name, botToken, chatId }` shape no longer matches the id-keyed configs. It seeded nothing, so removing it is a no-op at runtime.

## Surprises

- **The `notificationType` discriminator reuses the existing `NotificationChannel` enum.**
  The rule engine already had `NotificationChannel` (value `telegram`) for `NotificationAction.channel`.
  The config field is named `notificationType` but typed `NotificationChannel` — one vocabulary for the same concept, rather than a parallel enum.
- **Immutability of `notificationType` on `PATCH` needs zero code.**
  The global `ValidationPipe` runs with `forbidNonWhitelisted`, so simply *omitting* `notificationType` from the update DTO makes any body carrying it a 400 — the discriminator can't be changed via `PATCH` without a domain check.
- **The `DomainExceptionFilter` maps errors by explicit `instanceof` membership lists, not a name-suffix heuristic.**
  New domain errors (`NotificationConfigError` / `…NotFoundError` / `…ConflictError`) had to be registered in its `CLIENT_INPUT_ERRORS` / `NOT_FOUND_ERRORS` / `CONFLICT_ERRORS` arrays, or they'd fall through to a 500.
- **Radix Themes `Tabs.Trigger` renders its label twice** — a visible span plus a hidden bold-width placeholder — so a trigger's accessible name is the doubled text (e.g. `GeneralGeneral`).
  The tab tests match the name with a regex (`/General/`) rather than an exact string.
- **The vestigial `TELEGRAM_DESTINATIONS` env path was removed.**
  It parsed into `AppConfig.telegramDestinations` but was never consumed at runtime (nothing seeded it into the store); it referenced the deleted `TelegramDestination` type and its shape no longer matched the id-keyed configs, so the type removal forced the cleanup.
- **Testcontainers (Docker) is unavailable in the dev sandbox**, so the Mongo-backed `notifications.e2e-spec.ts` runs only in CI.
  The Docker-free `http-contract.integration.spec.ts` exercises the full controller behind the real pipe + filter over an in-memory store, covering every route/status/envelope; the Mongo round-trip is otherwise proven by the unchanged `ConfigRepository` contract suite.
