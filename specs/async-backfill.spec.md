# Spec: asynchronous backfill jobs

- Status: approved
- Touches: `core` (`BackfillConflictError`), `engine` (`BackfillJobService`,
  `BackfillJob` types, `BackfillService.assertBackfillable`), `api` (candles
  controller → 202 + job resource, job status route, per-job progress hub), `cli`
  (unchanged — keeps the synchronous `BackfillService`).

## Goal

`POST /symbols/:id/backfill` ran the entire fetch+persist synchronously inside the
HTTP request: the connection was held for the whole backfill, progress `total` was
unknown until the fetch finished, the WebSocket hub keyed frames by symbol id (so
two concurrent backfills of different periods interleaved indistinguishably), and
nothing stopped two concurrent backfills of the same symbol+period.

Model a backfill as a **job resource**: the POST validates, starts the work in the
background, and returns **202 Accepted** with the job (id + status). Progress and
the final summary are tracked per job and readable over a status route and a
per-job WebSocket.

## Domain / application model

- `BackfillJobStatus` enum: `Running` | `Succeeded` | `Failed`.
- `BackfillJob`: `{ id, symbolId, period, status, progress, summary, error }`
  (`progress` null until the first chunk; `summary` set on success; `error` on
  failure).
- `BackfillService.assertBackfillable(id, period)` — the existing watched/period
  validation, extracted so it can run **before** a 202 (client errors stay
  synchronous), and still called by `backfill`.
- `BackfillJobService(backfill, onUpdate?, newId?)`:
  - `start(id, period, range?)` — `assertBackfillable` first (so a not-watched
    symbol is a synchronous 404, a bad period a 400); reject with
    `BackfillConflictError` if a job for that `(id, period)` is already `Running`
    (→ 409); otherwise create a `Running` job, run `backfill` in the background
    (updating the job's progress, then `Succeeded` + summary or `Failed` + error),
    and return the job immediately.
  - `get(jobId)` — the job, or `null`.
  - `list()` — all jobs.
  - calls `onUpdate(job)` on every state change (start, each progress tick,
    terminal), so a transport can stream it (per ADR-0005, the API renders it).

## API

- `POST /symbols/:id/backfill` → **202** with `{ id, symbolId, period, status }`;
  **404** not watched, **400** bad period/range, **409** already running.
- `GET /symbols/:id/backfill/jobs/:jobId` → **200** the job; **404** unknown job.
- `WS /symbols/:id/backfill/jobs/:jobId/progress` → progress then summary frames,
  keyed by **job id** (concurrent jobs no longer interleave).

## Acceptance criteria

- `assertBackfillable` throws `SymbolNotFoundError` (not watched) / `CandleError`
  (period not watched); `backfill` still enforces the same.
- `start` returns a `Running` job and, once the background work settles, the job is
  `Succeeded` with the summary (or `Failed` with the error message).
- `start` throws `BackfillConflictError` when a `Running` job already exists for the
  same `(id, period)`; a different period is allowed concurrently.
- `onUpdate` fires for the initial `Running` job, each progress tick, and the
  terminal state.
- `POST` returns 202 + the running job; a second concurrent POST for the same
  symbol+period returns 409; `GET …/jobs/:jobId` returns the job; an unknown job id
  is 404.
