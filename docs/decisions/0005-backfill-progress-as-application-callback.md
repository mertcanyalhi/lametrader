# Backfill progress as an application callback, rendered by transports

- Status: accepted

## Context

Backfilling historical candles (slice 2) is long-running, so the CLI and API must
surface progress as it happens. The brief floated WebSocket for the API. Progress
visibility is therefore needed across two very different transports — a CLI writing
lines to stdout, and an HTTP API pushing frames to a browser — and the live-candle
streaming of slice 3 will need a third path over the same data.

Putting WebSocket (or any transport) knowledge inside the `BackfillService`
application use-case would invert the dependency rule (application depending on a
driving adapter) and couple the core work to one delivery mechanism.

## Decision

`BackfillService.backfill` accepts an optional `onProgress({ saved, total })`
callback and calls it after each persisted chunk. The application knows nothing
about how progress is delivered.

Each driving adapter renders that callback its own way:

- the **CLI** passes an `onProgress` that writes `progress: <saved>/<total>` lines;
- the **API** passes an `onProgress` that publishes to a small in-adapter
  `BackfillProgressHub` (keyed by symbol id), which fans frames out to any
  WebSocket subscriber of `/symbols/{id}/backfill/progress`, followed by a terminal
  `summary` frame.

The hub lives entirely in the `api` package; the engine has no WebSocket dependency.

## Consequences

- The dependency rule holds: progress is a plain application-level event; transports
  are outer-ring renderings of it. Adding a transport (or slice 3's live streaming)
  means writing another adapter, not touching the use-case.
- The use-case stays trivially unit-testable — assert the `onProgress` call sequence
  against a fake, with no socket or HTTP server involved.
- A subscriber must connect *before* a backfill runs to see its frames; the hub does
  not replay history. Acceptable here (the POST that triggers a backfill is the same
  client's action). A durable/replayable progress log is out of scope.
- Progress granularity is one frame per persisted chunk (500 candles), not per
  fetched row — coarse but bounded and adequate for a progress indicator.
