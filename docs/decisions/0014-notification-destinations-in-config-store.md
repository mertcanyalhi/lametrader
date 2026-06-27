# 0014. Notification destinations live under the K/V config store, not their own collection

- Status: accepted
- Date: 2026-06-27

## Context

Telegram destinations were modelled as a first-class list resource:
their own Mongo collection (`telegramDestinations`), a dedicated
`TelegramDestinationsRepository` port, an in-memory + Mongo adapter pair,
a shared contract test, REST routes under `/notification/telegram/destinations`,
and a unique-name index in the collection.

In practice the resource carries 1–10 entries, sees a handful of writes per
day, is admin-edited only, and users reach for it from the same Settings
page as the scalar `Config` (`periods`, `defaultPeriod`).
Adding more notification channels under their own top-level prefixes would
multiply the same setup (Slack collection, Slack port, Slack adapter, …).

Other list resources (rules, profiles, watchlist) keep their own collections
because they grow large, write often, and need indexed queries — none of
which apply to notification destinations.

## Decision

Fold notification destinations into the shared config K/V store.

- New key `ConfigKey.TelegramDestinations` holds a `TelegramDestination[]`.
- `TelegramDestinationsService` reads/writes the array via the existing
  `ConfigRepository` (read array → mutate → write array back).
- The dedicated port + in-memory + Mongo adapter + shared contract are
  deleted; the `telegramDestinations` collection is gone.
- REST routes move under `/config/notifications/telegram` to mirror the
  resource hierarchy (destinations are a sub-resource of `config`, not a
  separate top-level concern).
- CLI moves to `lametrader config notifications telegram <list|set|delete|test>`
  for the same reason.
- Name uniqueness moves from a unique index to service-level validation
  (replace-or-append by `name` on every upsert).
- Concurrency model: last-write-wins on the whole array — acceptable at
  single-tenant, admin-write-rare scale.

The `/config/notifications/` prefix is forward-compatible: a Slack channel
would land as a sibling key (`ConfigKey.SlackDestinations`) and sibling
routes (`/config/notifications/slack`), no new collection or port required.

## Consequences

**Easier:**

- One fewer collection, port, adapter pair, and contract suite per
  notification channel.
- Admin settings live together (`/config`, `/config/notifications/*`) in
  the API and the UI's Settings page.
- Adding a sibling channel is a new key + a new sub-route, not a new
  storage layer.

**Ruled out:**

- Indexed/paginated reads on destinations (none needed at this scale).
- Concurrent partial updates: two simultaneous upserts race at the array
  level; the last write wins. Acceptable given write rate and admin-only
  edits.

**Accepted divergence:**

- This breaks the "list resource = its own collection + port + adapter
  pattern" used by rules, profiles, and the watchlist. The divergence is
  intentional and scoped to admin-edited, low-volume reference data; the
  ADR is the next reader's anchor.
