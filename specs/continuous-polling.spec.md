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
- [ ] explicit `range` ⇒ `period1 = range.from`, `period2 = range.to` (unchanged).

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
