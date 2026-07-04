# Spec: rules — drop the remaining `v2` references

- Status: draft
- Touches: `@lametrader/engine` (rules persistence + event-log adapters, watchlist repo doc comment, profile-service docs, evaluation-context + lookups docs, orchestrator + bridges docs, dispatch docs, indicator-series-store, tick-ring, wire); `@lametrader/core` (rules type JSDoc); `@lametrader/ui` (rule editor HTML element IDs + every rules-page JSDoc + lib/hooks/api-fetch JSDoc, README); `@lametrader/api` (controllers + schemas comments + e2e wording); specs / docs prose; `CONTEXT.md`; a new operator-controlled Mongo migration script.

## Goal

Issue #422 / PR #423 dropped the `-v2` suffix from every code identifier and file basename but deliberately retained the persistent literals (`rules_v2` collection, `events_v2` watchlist field) and ~50 JSDoc / HTML-ID references for back-compat.
Issue #437 overrides that compromise — the user wants every `v2` reference gone for cognitive clarity.

The change is two coupled concerns landed in one PR:

1. A one-shot, operator-controlled Mongo migration that renames the `rules_v2` collection to `rules` and the watchlist field `events_v2` to `events`.
2. Engine + web + API + specs + docs cleanup that updates every `v2` JSDoc comment, prose mention, and the rule-editor HTML element IDs.

After this change the engine reads / writes only the new names; running the engine without first executing the migration script against an existing dataset will read empty collections / fields (loud-failure: operators see no rules / no events instead of subtle drift).

## Acceptance criteria

Each bullet maps to exactly one test (where tests are required) or one concrete code surface change.

### Code surface — Mongo collection literal

- The `MongoRuleRepository` reads / writes the `rules` collection (not `rules_v2`) for every CRUD method.
- The `MongoEventLog` reads / writes rule events on the `rules` collection (not `rules_v2`).
- A grep over `packages/**` for the literal string `'rules_v2'` returns no matches.

### Code surface — watchlist field literal

- The `MongoEventLog` `$push`-appends symbol events to the `events` field on watchlist documents (not `events_v2`).
- The `MongoEventLog` `findOne` projects + reads the `events` field on watchlist documents (not `events_v2`).
- A grep over `packages/**` for the identifier `events_v2` returns no matches.

### Code surface — HTML IDs

- `rule-editor-dialog.tsx` uses `rule-name` / `rule-description` / `rule-enabled` for the `id` and `htmlFor` attributes (not `rule-v2-*`).
- Existing component test continues to bind label → input via accessible name without referencing the literal `v2`-prefixed id (queries by role + name, which the rename does not break).

### Migration script

- A standalone TypeScript script `packages/engine/src/scripts/migrate-rules-v2-to-rules.ts` exposes a `migrateRulesV2ToRules(db)` function that:
  - Renames the `rules_v2` collection to `rules` when the source collection exists; no-ops when it does not exist (idempotent re-run).
  - Renames the `events_v2` field to `events` on every watchlist document via an aggregation pipeline `$rename`; no-ops on documents that lack the legacy field.
  - Throws when both `rules` and `rules_v2` collections exist (operator must reconcile manually rather than the script choosing).
- The script is runnable as `node packages/engine/dist/scripts/migrate-rules-v2-to-rules.js` against a connection string read via `loadSettings()` so the operator runs it once at deploy time.
- An e2e test against a Testcontainers Mongo seeds a `rules_v2` collection + a `watchlist` document with `events_v2`, runs the migration, and asserts:
  - `rules_v2` no longer exists; `rules` does, with the same documents.
  - `watchlist.events_v2` is gone; `watchlist.events` carries the events in the same order.
- An e2e test asserts the migration is idempotent — running it twice on a fresh dataset is a no-op the second time (no errors, same final state).
- An e2e test asserts the migration throws when both `rules` and `rules_v2` collections exist (loud failure, operator must reconcile).

### JSDoc / prose / comments

- No source line under `packages/**` carries the substrings `v2 ` (lowercase v two + space), `V2` (uppercase), or `events_v2` / `rules_v2` / `RulesV2` outside of the documented exceptions (see "Out of scope" below).
- `mongo-watchlist-repository.ts` line that previously claimed v2 stores rule events in a `rule_events_v2` collection is corrected to reflect the actual storage on the watchlist document's `events` array.
- `CONTEXT.md` — the cross-symbol-operand line that read "no cross-symbol operand references in v2" is rewritten in present tense without `v2`; the historical-cleanup paragraph mentioning issue #422 is updated to fold issue #437 in as the second / final cleanup pass.
- The closed-chapter rules specs (`rules-persistence`, `rules-rest-api`, `rules-cutover`, `rules-core-types`, `rules-web-ui`, `rules-orchestrator-action-runner`, `rules-series-store-eval-context`, `rules-rename-drop-v2-suffix`) move under `specs/_archive/` with a short `README.md` noting the exemption — they document the original greenfield build that has shipped, and the live source-of-truth is now ADR 0016, `CONTEXT.md`, and the per-package READMEs.
- The active chart-side specs (`chart-symbol-rule-events.spec.md`, `chart-symbol-rules-modal.spec.md`, `chart-state-overlays.spec.md`) have their `v2` mentions rewritten in present tense in-place.
- `packages/ui/README.md:45` and `packages/api/README.md` references to `events_v2` are rewritten.

### Build / test gates

- `npm run check:full` is green.
- The existing `rules-rule-repository.e2e.test.ts` and `rules-event-log.e2e.test.ts` continue to pass against the renamed collection + field literals (their internal cleanup `deleteMany({})` calls move to `rules`; their JSDoc moves off `v2`).

## End-to-end expectation

A single happy path the new migration e2e asserts:

1. Spin Mongo via Testcontainers.
2. Seed `db.rules_v2` with two rule documents and `db.watchlist` with a document carrying `events_v2: [eventA, eventB]`.
3. Call `migrateRulesV2ToRules(db)`.
4. Assert `db.rules` has both rule documents (full payload), `db.rules_v2` is absent, `db.watchlist.<id>.events === [eventA, eventB]`, and `db.watchlist.<id>.events_v2` is undefined.

The critical failure mode the e2e covers:

- When both `rules_v2` and `rules` collections exist (e.g. an operator partially ran the script), the migration throws a clear `Error` naming both collections and does not touch either — the operator must reconcile.

## Out of scope

- Renaming `docs/decisions/0016-rules-v2-greenfield-engine.md` — ADR filenames are immutable history (#422 locked decision).
- Rewriting the archived closed-chapter specs (`specs/_archive/*.spec.md`) — they preserve historical narrative and are exempt from the repo-wide `v2`-token rule by virtue of their location under `specs/_archive/`.
  The archive's `README.md` documents this exemption.
- A dual-read window or fallback path — option A (hard cutover) is chosen.
  Operators run the migration before deploying the new code; deploying without migrating against an existing dataset reads empty.

## Surprises

(Filled in retroactively if anything bites.)
