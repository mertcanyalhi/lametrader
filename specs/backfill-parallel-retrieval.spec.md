# Spec: parallel windowed Binance retrieval

- Status: approved
- Touches: `server` (`BinanceMarketDataSource.fetchCandles` — window-partitioned
  concurrent retrieval with 429 backoff; injectable clock + sleep for tests).

## Goal

Speed up deep Binance backfills.
The forward walk was strictly sequential — each page's `startTime` was the previous
page's last timestamp — so a deep 1m history was thousands of serial round-trips.
Since the windows of a `[earliest, end]` span are independent, retrieve them
**concurrently** with a bounded pool instead.

## Design

- **Span** — `end = range.to ?? now`; `earliest = range.from` for a ranged fetch, else
  the provider's first kline (a `limit=1` probe at `startTime=0`).
  Empty probe or `earliest >= end` ⇒ `{ candles: [], complete: true }`.
- **Windows** — partition `[earliest, end)` into fixed windows of
  `KLINES_LIMIT × periodMillis(period)` ms (≤ 1000 bars each).
  Window `w` is fetched with `startTime = w`, `endTime = w + windowMs − 1` (so adjacent
  windows never overlap), `limit = KLINES_LIMIT`.
- **Pool** — at most `CONCURRENCY` (8) windows in flight; results reassembled and sorted
  ascending by `time`, filtered to `[earliest, end)`.
- **Rate limits** — a `429` is retried up to `MAX_RETRIES` (5), waiting the response's
  `Retry-After` seconds (or a bounded default) between attempts; the wait uses an
  injectable `sleep` so tests stay fast. A non-429 error propagates (wrapped as
  `MarketDataError`, as before).
- **Completeness** — the whole span is covered, so `complete` is always `true`.
- **Progress** — `total = ceil((end − earliest) / periodMillis)` is known up front (exact
  bar from the start, no longer estimated from the first page); `onProgress(done, total)`
  fires as each window lands, `done` the cumulative retrieved count.

## Acceptance criteria (each → one unit test, full-payload `toEqual`)

- [ ] A no-range fetch probes the earliest kline, partitions `[earliest, now)` into
      windows, and returns every window's candles sorted ascending with `complete: true`.
- [ ] Windows are fetched concurrently: given a stub keyed by `startTime`, all expected
      window requests are issued (assert the set of `startTime`s), not a serial chain.
- [ ] A `429` response is retried after its `Retry-After` and then succeeds (injected
      no-op `sleep`), so the batch still returns its candles.
- [ ] A `429` that never clears (past `MAX_RETRIES`) surfaces as a `MarketDataError`.
- [ ] A ranged fetch partitions `[range.from, range.to)` (no probe) and drops candles
      outside the window.
- [ ] `onProgress` reports the up-front `total = ceil((end − earliest) / periodMillis)`
      and a monotonically increasing cumulative `done`.
- [ ] An unsupported period rejects with `CandleError` before any request (unchanged).

## Out of scope

- Parallelising Yahoo (single-response) or the live poll loop.
- Adaptive concurrency / weight accounting beyond `Retry-After` backoff.
- Configurable concurrency (fixed constant; revisit only if prod tuning needs it).
