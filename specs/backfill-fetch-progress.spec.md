# Spec: backfill progress during retrieval

- Status: approved
- Touches: `core` (`BackfillPhase` enum, `CandleFeed.fetchCandles` port gains an
  `onProgress` callback), `server` (`BackfillProgress` shape, `BinanceMarketDataSource`
  /`YahooMarketDataSource`/`InMemoryMarketDataSource` progress emission, `BackfillService`
  loop, progress DTO), `ui` (phase-aware progress rendering).

## Goal

Report backfill progress **while candles are being retrieved**, not only while they
are saved.
Since removing the Binance page cap, retrieval walks the whole history over many
sequential requests and is now the dominant phase; today the FE progress bar sits at
`0` through all of it and only moves during the fast save tail.

The retrieval total is not known until the walk ends (the end of history is found by
hitting a short page), so retrieval reports against an **estimated** total derived
from the earliest candle seen and the target end, giving a real percentage during the
slow phase.

## Domain model

- **`BackfillPhase`** — enum: `Fetching` | `Saving`.
  Which half of a backfill a progress frame describes.
- **`BackfillProgress`** — `{ phase: BackfillPhase; done: number; total: number }`
  (was `{ saved; total }`).
  - `Fetching`: `done` = candles retrieved so far, `total` = the estimate.
  - `Saving`: `done` = candles persisted so far, `total` = the actual fetched count.

## Estimate

For a paged source (Binance) the first page starts at the earliest available candle,
so after page 1 the earliest candle `time` is known.
With `end = range.to ?? now` and `earliest = max(range?.from ?? 0, firstCandleTime)`:

```
estimatedTotal = max(1, ceil((end - earliest) / periodMillis(period)))
```

No extra probe request — the estimate is derived from data already fetched.
A single-response source (Yahoo, in-memory) has no slow retrieval phase: it emits one
`Fetching` frame with `done = total = <count>` once its response is in hand.

## Ports

- **`CandleFeed.fetchCandles(id, period, range?, onProgress?)`** — gains an optional
  `onProgress(done: number, total: number) => void`, invoked after each retrieved page
  (Binance) or once (single-response sources).
  The return type (`CandleBatch`) is unchanged; the callback is fire-and-forget.

## Use-case (`server`)

`BackfillService.backfill`:

- Passes an `onProgress` to `fetchCandles` that emits
  `{ phase: Fetching, done, total }` per page.
- Keeps the existing chunked save loop, now emitting
  `{ phase: Saving, done: saved, total: fetched.length }` per chunk.

## Acceptance criteria (each → one unit test, full-payload `toEqual`)

- [ ] Binance `fetchCandles` with an `onProgress` callback and two full pages + a short
      page invokes `onProgress` per page with `done` = cumulative candles and a `total`
      estimate ≥ `done`.
- [ ] Binance derives the estimate from the first page's earliest candle and the target
      end (`ceil((end - earliest) / periodMillis)`), so a 1h fetch whose earliest bar is
      `N` hours before `now` reports `total ≈ N`.
- [ ] A single-response source (in-memory) invokes `onProgress` once with
      `done === total === <count>`.
- [ ] `fetchCandles` with no `onProgress` behaves exactly as before (no throw, same batch).
- [ ] `BackfillService.backfill` emits `Fetching` frames during retrieval then `Saving`
      frames per 500-candle chunk: for 1200 candles the `Saving` frames are
      `{ Saving, done: 500, total: 1200 }`, `{ Saving, done: 1000, total: 1200 }`,
      `{ Saving, done: 1200, total: 1200 }`.

## FE

- The dialog labels the active phase (`Fetching…` / `Saving…`) and renders `done / total`
  as the bar; `percent` uses `done / total` (clamped to 100, `0` when `total <= 0`).

## Out of scope

- Streaming saves (fetch and save stay two phases; candles are still buffered between
  them). Memory-bounded save-per-page is a separate change.
- Parallel page retrieval.
