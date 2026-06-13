# 0006. fetchCandles returns a batch carrying completeness

- Status: accepted
- Date: 2026-06-13

## Context

`MarketDataSource.fetchCandles` returned `Promise<Candle[]>` and, with `range`
omitted, was contracted to return "the provider's deepest available history". The
Binance adapter cannot honour that for a keyless backfill: it caps paging at
`MAX_PAGES` (50 × 1000 candles) to stay bounded. When that cap is hit, the adapter
returned a truncated array indistinguishable from a complete one — and the
`BackfillSummary` reported `fetched === saved`, so a capped backfill looked like a
full one. A user backfilling years of minute data would silently get only the most
recent slice and no signal that history is missing. For a data-foundation feature,
that quietly corrupts trust in what is stored.

The service has no way to detect truncation from a bare `Candle[]`; only the
adapter knows whether it stopped at its own cap.

## Decision

`fetchCandles` returns a `CandleBatch = { candles: Candle[]; complete: boolean }`
(in `core`). `complete` is `false` only when the adapter stopped at a provider-side
cap with more rows available; `true` otherwise. `BackfillService` threads
`complete` into `BackfillSummary`, and it surfaces over the API/CLI summary, so a
truncated backfill is visible to the caller.

- Binance sets `complete = false` when it exits at `MAX_PAGES` on a still-full
  page; otherwise `true`.
- Yahoo (one-shot chart, no cap of ours) and the in-memory source always return
  `complete = true`.

## Consequences

- A truncated backfill is now honestly reported; callers can re-issue with a
  narrower `range` to fetch the rest. Deep, gapless auto-paging remains out of
  scope (the cap stays).
- The port's return shape changed — every adapter and the shared contract test were
  updated. This supersedes the backfill spec's note that `fetchCandles` returns a
  plain `Candle[]`.
- `complete` is a coarse boolean, not a cursor: it says "there is more", not "resume
  from here". A resumable deep-history cursor is deferred until a use-case needs it.
