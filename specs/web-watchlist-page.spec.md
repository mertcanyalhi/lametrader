# Spec: Web watchlist page (static)

- Status: draft
- Touches: `packages/web` (driving adapter) — new `pages/watchlist/*`, `lib/hooks/symbols.ts`; consumes the existing `@lametrader/api` symbols REST surface.

## Goal

Build the watchlist page (`/`, the homepage): a dense, sortable, trading-platform-style table of watched symbols showing the **snapshot** quote (`GET /symbols?enrich=true`), plus the management flows — add via instrument search (`GET /instruments` → `POST /symbols`), edit watched periods (`PATCH /symbols/:id`), and remove (`DELETE /symbols/:id`).
Live ticking, flashing price cells, and the shared `/stream` WebSocket client are a separate task and are out of scope here.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] Renders one table row per enriched symbol — id (mono), description (muted), type, formatted price, change, change %, and the watched-period chips — from `GET /symbols?enrich=true`.
- [ ] Renders skeleton rows while the list query is pending.
- [ ] Renders an empty state with a "Watch a symbol" action when the list is empty.
- [ ] Renders an error callout (the server message) when the list query fails.
- [ ] A symbol whose `quote` is `null` renders `—` for price, change, and change %.
- [ ] Default sort is by Symbol ascending.
- [ ] Clicking the Symbol header again toggles the sort to descending.
- [ ] Clicking the Price header sorts rows by price ascending.
- [ ] Clicking the Chg % header sorts rows by change % ascending.
- [ ] Clicking the Type header sorts rows by type ascending.
- [ ] Add flow: searching in the dialog issues `GET /instruments?q=…`, and selecting a result + Add issues `POST /symbols` with `periods` defaulted from the config, shows a success toast, and refetches the list.
- [ ] Edit flow: opening the edit dialog from the row's actions, changing the periods in its Periods section, and saving issues `PATCH /symbols/:id`, shows a success toast, and refetches the list.
- [ ] Remove flow: confirming in the `AlertDialog` issues `DELETE /symbols/:id`, shows a success toast, and refetches the list.
- [ ] A mutation that fails with `{ error }` surfaces the server message as an error toast and leaves the cached list unchanged.

## End-to-end expectation

API-side contract e2e (`packages/api/tests/e2e/watchlist-page.e2e.test.ts`), mirroring the `settings-page.e2e.test.ts` precedent — the same Fastify app the browser hits, over real Mongo (Testcontainers) with an in-memory market-data source.

- **Happy path** — traces the exact round-trip the page drives: `GET /instruments?q=` (discover) → `POST /symbols` (add) → `GET /symbols?enrich=true` (the enriched list the table renders) → `PATCH /symbols/:id` (edit periods, reflected in the enriched list) → `DELETE /symbols/:id` → `GET /symbols?enrich=true` returns `[]`.
- **Critical failure mode** — `POST /symbols` for a symbol the source can't resolve returns `404` with `{ error }` (the message the page surfaces as a toast) and the watchlist stays empty.

## Out of scope

- Live quote ticking, the price-cell flash, and the shared `/stream` WebSocket client (the "Watchlist live quotes" task).
- The auto-opening backfill modal on add success (issue #46 — not yet present).
- Volume column, drag-to-reorder, per-row sparkline.
- A browser e2e harness (Playwright/Storybook) — page behaviour is covered by the jsdom component tier, the backend contract by the API e2e.

## Surprises

_(filled in after the feature lands)_
