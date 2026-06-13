# 0008. Backfill is an asynchronous job resource (202 + poll/stream)

- Status: accepted
- Date: 2026-06-13

## Context

`POST /symbols/:id/backfill` executed the whole backfill synchronously in the
request handler. The connection was held for the entire fetch+persist; progress
`total` was unknown until the fetch completed (so the slow network phase reported
nothing); the WebSocket hub keyed frames by symbol id, so two concurrent backfills
of different periods interleaved indistinguishably; and nothing prevented two
concurrent backfills of the same symbol+period racing on the same keyset.

## Decision

Model a backfill as a **job resource**. `POST` validates synchronously, starts the
work in the background, and returns **202 Accepted** with the job (`id`, `status`).
A `BackfillJobService` (application) owns an in-process job registry, runs
`BackfillService.backfill` in the background, and updates each job's progress and
terminal state. It exposes `start` / `get` / `list` and an `onUpdate` listener that
the API renders as per-job WebSocket frames (consistent with ADR-0005 — the
application stays transport-agnostic). Progress and frames are keyed by **job id**.

Synchronous client errors are preserved: `start` calls
`BackfillService.assertBackfillable` before creating a job, so a not-watched symbol
is still a 404 and a bad period a 400 — not a 202 followed by a silently failed
job. A second concurrent backfill of the same `(symbol, period)` is rejected with
`BackfillConflictError` (409).

The CLI keeps driving the synchronous `BackfillService` directly — a one-shot
command that prints progress lines and the summary needs no job indirection.

## Consequences

- The HTTP request returns promptly; long backfills no longer hold the connection,
  and clients poll `GET …/jobs/:jobId` or stream the per-job WebSocket. Concurrent
  jobs are distinguishable and same-key races are rejected.
- The job registry is **in-process and non-durable** — jobs are lost on restart and
  not shared across instances (same boundary ADR-0005 set for progress). A durable
  job store is deferred until multi-instance operation needs it.
- `fetchCandles` still materializes the fetched window in memory before persisting;
  streaming the fetch is a separate, larger change and stays out of scope (the
  provider page cap from ADR-0006 keeps it bounded).
