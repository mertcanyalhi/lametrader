# Spec: continuous polling + live candle streaming (slice 3)

- Status: draft
- Touches: `core` (`periodMillis` helper), `engine` (`PollingService` use-case +
  `CandleEvent`/`CandleListener` types; `connectServices` wires it; `loadSettings`
  gains `pollIntervals`; Yahoo intraday no-range bug-fix), `api` (`CandleStreamHub`
  + multiplexed `GET /stream` WebSocket route; `main.ts` starts/stops polling).

## Goal

When the service starts, continuously poll new OHLC candles for every watched
symbol+period and push them to WebSocket clients watching that symbol. Polling
**resumes after a restart from where it left off** — storage is the durable cursor:
for each symbol+period, resume from `CandleRepository.latest(id, period)?.time`,
`fetchCandles(id, period, { from, to: now })`, then `save()` (idempotent upsert, so
re-fetching the still-forming bar just updates it). This is slice 3 building on the
backfilled data foundation (slice 2).

## Domain model

- **`periodMillis(period): number`** (`core`) — the fixed duration of a {@link Period}
  in milliseconds (`1m → 60_000`, … `1w → 604_800_000`). Pure; lets the application
  decide whether a candle's bar has closed.
- **`CandleEvent`** (`engine`) — `{ id, period, candle, final }`. `final` is `true`
  when the bar has closed (`candle.time + periodMillis(period) <= now`), `false` for
  the still-forming bar. Emitted per fetched candle on each poll.
- **`CandleListener` = `(event: CandleEvent) => void`** — transport-agnostic sink the
  application emits to (mirrors backfill's `onProgress`; see ADR-0005).

## Use-case (`engine`)

`PollingService(sources, candles, watchlist, options)` where `options` is
`{ onCandle: CandleListener; intervals: Record<Period, number>; now?; random? }`
(`now` defaults to `Date.now`, `random` to `Math.random` — both injectable for tests).

- `poll(): Promise<void>` — one sweep over every watched symbol+period (the
  deterministic unit). For each: load `latest`; **skip if none** (assume backfill ran
  first); else `fetchCandles(id, period, { from: latest.time, to: now() })`, `save()`
  the result, and emit one `CandleEvent` per fetched candle (forming bar re-fetched ⇒
  re-emitted with `final: false`). A `MarketDataError` on one symbol is caught and
  skipped — the sweep continues with the rest.
- `start(): void` — schedule a recurring poll **per period** at its configured
  interval plus jitter (`delay = interval * (1 + random() * JITTER_FRACTION)`), each
  tick re-reading the watchlist and polling the symbols carrying that period. Spreads
  load to respect provider rate limits.
- `stop(): void` — cancel all pending timers; no further polls fire.

Depends only on existing ports (`WatchlistRepository.list`,
`MarketDataSource.fetchCandles`, `CandleRepository.latest` + `save`). No transport
knowledge — the WS rendering lives in the `api` adapter (ADR-0005).

## Settings (`engine`)

`loadSettings` gains `pollIntervals: Record<Period, number>` — per-period poll
cadence in ms, defaulting so short bars poll more often than long ones: `1m: 5s`,
`5m: 30s`, `15m: 60s`, `30m: 120s`, `1h: 5m`, `4h: 15m`, `1d: 30m`, `1w: 1h`. A
`POLL_INTERVALS` env var (JSON object, period→ms) overrides individual periods,
merged over the defaults.

## API adapter

- **`CandleStreamHub`** (clone of `BackfillProgressHub`): `subscribe(id, fn) → unsub`
  and `publish(event)` fanning a `CandleEvent` to subscribers of `event.id`.
- **`GET /stream`** (WebSocket, multiplexed): the client sends
  `{ "action": "subscribe", "id": "<symbolId>" }` / `{ "action": "unsubscribe", "id" }`
  messages so one socket can watch many symbols. The route forwards each `CandleEvent`
  for a subscribed id as a JSON frame; closing the socket unsubscribes everything.
- `main.ts` creates the hub, wires `onCandle → hub.publish`, registers `/stream`,
  `polling.start()` after `connectServices`, and `polling.stop()` on SIGTERM/SIGINT.

## Yahoo intraday bug-fix (`engine`)

`YahooMarketDataSource.fetchCandles` with no `range` passed `period1: new Date(0)`,
which Yahoo rejects for intraday intervals (they allow only a bounded lookback) →
502 on intraday polling. Fix: when `range` is omitted, intraday intervals use
`period1 = now - maxLookback(interval)` (1m → 7d; 5m/15m/30m → 60d; 1h → 730d);
daily/weekly keep `new Date(0)` (full history). Range computation extracted to a pure
`resolveYahooChartRange(period, range, now)` so it's unit-testable without the network.

A second Yahoo quirk affects the *ranged* (polling) path: when the request window
starts at — or within one bar of — the in-progress bar's open (exactly the tight
resume window a poll uses, `from = latest.time`), Yahoo returns that bar with
**zero volume** and a degenerate, often flat OHLC, while a wider window returns it
with real accumulating data.
So `resolveYahooChartRange` widens an intraday explicit range so its start spans at
least `LIVE_POLL_MIN_BARS` (3) completed bars before the end
(`period1 = min(range.from, range.to - 3 · periodMillis)`); daily/weekly ranges are
left exact.
The extra older bars are already stored (idempotent upserts), so re-fetching them
each poll is harmless.

`toCandle` also guards completeness so degenerate provider bars are never ingested:
a bar missing any of OHLC is dropped (an existing rule), and — for equities/funds,
which carry volume — a bar with a **missing** volume is dropped rather than stored
with a fabricated `0`.
A *present* `volume: 0` is a real no-trade interval and is kept (so the guard rejects
absent fields, not legitimate zero values); FX has no volume and is exempt.

- [ ] `fetchCandles` drops an equity bar whose volume is absent (no fabricated `0`)
      but keeps a bar whose volume is a real `0`.

## Yahoo live-bar merge fix (`engine`)

Yahoo's v8 chart appends the in-progress interval stamped at the live update time
(≈ `now`) as a *separate* quote from that interval's grid-aligned bar — and it
leaves the aligned bar's OHLC `null` until the interval closes, carrying the live
price only on the trailing row.
Persisting that row verbatim scattered a new sub-period row each poll (the candle
key is `(symbol, period, time)`) and, because the sub-period stamp became the
resume cursor, the closed bar's final data was never re-fetched — so 1m series
showed both duplicate sub-minute candles and missing aligned bars (an hourly chart
showing 08:07, 08:22, 08:35).
The aligned current-bucket placeholder is not always there to anchor onto: crypto
includes a null-OHLC bar for the in-progress interval, but equities/FX omit it, so
the live row follows the last *completed* bar directly (e.g. a 5m series jumping
`11:50 → 11:57`).
A "within one period of the previous quote" rule therefore misses the equities/FX
case — the live row is always at least one period past the last completed bar.
Fix (generalises yahoo-finance's `fix_Yahoo_returning_live_separate`):
`YahooMarketDataSource.fetchCandles` takes the grid *phase* from the previous quote
and snaps the trailing live row to its bucket open,
`live - ((live - prev) % periodMillis(period))`, *before* mapping.
A zero remainder means the trailing quote is itself grid-aligned (a genuine bar) and
the series is left untouched.
Otherwise, when the previous quote is that bucket it is merged onto (open from the
live row when still null, running high/low, the live close, summed volume — the live
row carries none of its own); when the bucket has no quote yet the live row is
re-stamped to the bucket open.
Phasing off Yahoo's own previous bar (not epoch modulo) keeps session/DST-anchored
bars correct — e.g. an equity 1h bar opening at `:30`.
The fix covers both backfill and polling (both go through `fetchCandles`); daily and
weekly keep the simpler same-interval merge; Binance is unaffected (kline `openTime`
is already aligned).

Across the period boundary the resume cursor therefore stays on the aligned bar:
each poll re-fetches `{ from: latest.time, to: now }` inclusive of it and `save`
upserts, so when the bar closes the next poll overwrites its partial snapshot with
the provider's final OHLC and emits it as `final`.

- [ ] `fetchCandles` merges a trailing live row into the aligned in-progress bar
      (running high/low, live close), keeping the aligned timestamp.
- [ ] `fetchCandles` fills a null-OHLC aligned current-period bar from the trailing
      live row (the 1m case).
- [ ] `fetchCandles` re-stamps a trailing live row that opens a new bucket with no
      placeholder to its bucket open (the equities/FX 5m case).
- [ ] `fetchCandles` snaps the live row using the previous bar's grid phase, not
      epoch modulo (a session-anchored 1h `:30` bar merges correctly).
- [ ] `fetchCandles` leaves an already-aligned series (no sub-period trailing row)
      unchanged.
- [ ] `poll()` re-fetches the resume bar and overwrites its partial data with the
      provider's final values (the closed bar is corrected on the next poll).

## Acceptance criteria (each → one unit test, full-payload `toEqual`)

Domain (`core`):

- [ ] `periodMillis(Period.OneMinute)` is `60_000`; `periodMillis(Period.OneDay)` is
      `86_400_000`; `periodMillis(Period.OneWeek)` is `604_800_000`.

Application — `PollingService` (fake source + fake `CandleRepository` + fake
`WatchlistRepository`, injected `now`):

- [ ] `poll()` resumes from `latest`: fetches `{ from: latest.time, to: now }`,
      persists the fetched candles, and the store then contains the merged series.
- [ ] `poll()` emits one `CandleEvent` per fetched candle with `final` set by bar
      close: a bar whose `time + periodMillis <= now` is `final: true`, the forming
      bar (`> now`) is `final: false`. (Assert the full emitted event array.)
- [ ] `poll()` skips a symbol+period with no stored candles — no fetch, no save, no
      emit (assert the source was not called and no event emitted).
- [ ] `poll()` catches a `MarketDataError` from one symbol and still polls the others
      (the healthy symbol's candles are emitted/persisted; the loop does not throw).
- [ ] `start()` schedules a poll per period at its configured interval (with
      `random: () => 0`, advancing fake timers by `intervals[period]` triggers exactly
      one poll for that period); `stop()` cancels pending timers (no poll after stop).

Settings (`engine`):

- [ ] `loadSettings({})` returns the default `pollIntervals` (1m polled more often
      than 1d).
- [ ] `loadSettings({ POLL_INTERVALS: '{"1m":5000}' })` overrides `1m` to `5000`,
      leaving the other periods at their defaults.

Yahoo bug-fix (`engine`, pure `resolveYahooChartRange`, injected `now`):

- [ ] no `range`, intraday interval (`1m`) ⇒ `period1 = now - 7d`, `period2 = now`
      (not `new Date(0)`).
- [ ] no `range`, daily interval (`1d`) ⇒ `period1 = new Date(0)`, `period2 = now`.
- [ ] explicit `range`, daily ⇒ `period1 = range.from`, `period2 = range.to` (unchanged).
- [ ] explicit `range`, intraday, already spanning ≥ 3 bars ⇒ `period1 = range.from`.
- [ ] explicit `range`, intraday, narrower than 3 bars (a poll's resume window) ⇒
      `period1 = range.to - 3 · periodMillis` — widened so Yahoo returns the
      in-progress bar with real volume/OHLC instead of a zero-volume snapshot.

API adapter:

- [ ] `CandleStreamHub` fans a published `CandleEvent` to every subscriber of its id,
      to no other id, and stops after unsubscribe (full-frame `toEqual`, mirrors the
      `BackfillProgressHub` suite).

## End-to-end expectation

API e2e over **real Mongo** (Testcontainers) with a **stub `MarketDataSource`** whose
seeded series **grows over time** (more candles appear on later `fetchCandles` calls):

- Happy path: seed the store with an initial candle (the "already backfilled" cursor);
  open the `/stream` WebSocket and send `subscribe` for the symbol; `polling.poll()`
  (or `start()` + a tick); assert (a) the new candles are **persisted resuming from
  latest** (read them back) and (b) the WS subscriber **received the streamed
  `CandleEvent` frames** with the right `final` flags.
- Critical failure mode: one watched symbol's source **throws** (`MarketDataError`) —
  the poll keeps the loop alive and the **other** symbol still polls, persists, and
  streams.

## Out of scope (not now)

- Replaying history to a late WS subscriber (hub is live-only, like the progress hub).
- Gap detection / re-fetch of missing windows; per-provider adaptive backoff beyond
  the fixed interval + jitter.
- Authentication / per-client rate limiting on the WS endpoint.
- Indicators/signals/backtests over the streamed candles.
- Binance has no analogous no-range intraday limit to fix; only Yahoo is touched.
