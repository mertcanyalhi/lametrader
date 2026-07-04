# Spec: Backfill UI (per-symbol trigger modal + live WS progress)

- Status: draft
- Touches: `packages/ui` (driving adapter) — new `lib/ws/` (per-job WebSocket base), `lib/hooks/backfill.ts`, `pages/watchlist/backfill-dialog.tsx`; wires into `watchlist-row.tsx` and `add-symbol-dialog.tsx`. Drives the existing backfill job API (no backend change).

## Goal

Give the watchlist a way to trigger and monitor historical backfills from the UI: a per-symbol modal that starts a backfill job per selected period (`POST /symbols/:id/backfill`), streams live progress over the per-job WebSocket (`WS …/jobs/:jobId/progress`), and surfaces success summaries and failures with retry.
Backfilling is decoupled from watchlist management on the backend, so this is its own UI concern; the natural "add → backfill" flow is offered by auto-opening the modal after a successful add.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] The row's "Backfill" action opens the modal, which lists the symbol's watched periods (preselected).
- [ ] Successfully adding a symbol auto-opens the backfill modal for the new symbol, its watched periods preselected.
- [ ] Starting a backfill issues `POST /symbols/:id/backfill` per selected period and renders a live progress bar driven by the per-job WebSocket, resolving to a success summary on the terminal (`succeeded`) frame.
- [ ] A job that streams a `failed` frame shows its error message and a Retry control that re-starts that period's job (a fresh `POST`).
- [ ] A `409` (already running) on start is surfaced inline with a Retry, not as a crash.
- [ ] Omitting the range sends `{ period }` only; entering an explicit from/to range passes it through as epoch-ms `from`/`to`.

## End-to-end expectation

API-side contract e2e (`packages/api/tests/e2e/backfill-ui.e2e.test.ts`), mirroring the existing `backfill.e2e.test.ts` harness — the same Fastify app over real Mongo (Testcontainers) with an in-memory source.

- **Happy path** — the round-trip the modal drives: `POST /symbols/:id/backfill` returns `202` with a `running` job; the per-job WebSocket streams frames to a terminal `succeeded` frame whose `summary` matches the persisted candles.
- **Critical failure mode** — starting a second backfill for the same `(symbol, period)` while one is running returns `409` with `{ error }` (the inline error the modal surfaces).

## Out of scope

- Live quote ticking and the shared `/stream` WS client (separate task) — though the per-job WS base here is written to be reusable.
- A global cross-symbol backfill/jobs dashboard.
- Gap detection, automatic re-fetch, or recurring/scheduled backfills.
- Any backend change to the backfill job resource (already implemented per ADR-0008).

## Surprises

_(filled in after the feature lands)_
