# Spec: backfill — typed OHLC candle storage

- Status: approved
- Touches: `core` (`Candle` discriminated union + `CandleError` + `parseBackfillRange`,
  `CandleRepository` port, `MarketDataSource.fetchCandles` port extension), `engine`
  (`BackfillService` use-case, `MongoCandleRepository` + `InMemoryCandleRepository`
  driven adapters, `fetchCandles` on Binance/Yahoo/in-memory sources), `cli` + `api`
  (driving adapters to trigger a backfill, stream progress over WebSocket, and read
  candles back).

## Goal

Backfill historical OHLC data for a **watched** symbol+period into MongoDB, stored
in a **typed parent/child structure** (shared OHLC base + per-asset-class fields),
triggered over CLI/API, **reporting progress** as it persists. Reading candles back
proves they landed. This is the data foundation continuous polling (slice 3) resumes
from.

## Domain model

- **`Candle`** is a discriminated union on `type: SymbolType`, sharing an OHLC base:
  - base: `{ time: number (open time, epoch ms UTC), open, high, low, close }`
  - `CryptoCandle` (`type: Crypto`): `+ volume` (base-asset), `quoteVolume`, `trades`
  - `EquityCandle` (`type: Stock | Fund`): `+ volume`, `adjClose` (split/div-adjusted)
  - `FxCandle` (`type: Fx`): base only — FX spot has no consolidated volume
- **`BackfillRange` = `{ from: number; to: number }`** — epoch-ms half-open window
  `[from, to)`, `from < to`. **Optional**: omitted ⇒ backfill the provider's deepest
  available history (each adapter knows its own max-lookback; the stub returns all it
  holds).
- A candle is a **per-(symbol, period, time) singleton** in storage (re-backfilling a
  range replaces, never duplicates — upsert by that key).

## Ports

- **`CandleRepository`** (driven, in `core`):
  - `save(symbolId, period, candles): Promise<void>` — upsert by `(symbol, period, time)`.
  - `range(symbolId, period, from, to): Promise<Candle[]>` — stored candles in
    `[from, to)`, ascending by `time`.
  - `latest(symbolId, period): Promise<Candle | null>` — highest-`time` stored candle
    (`null` if none). Sets up slice-3 resume.
- **`MarketDataSource` gains** `fetchCandles(symbolId, period, range?): Promise<Candle[]>`
  — provider OHLC for the window (or deepest history when `range` is omitted), ascending
  by `time`, typed for the source's class.
  (Same provider already owns discovery for the type; one adapter, ISP-acceptable.)

## Errors

- `CandleError` — invalid range / period-not-watched. Maps to **400**.
- `SymbolNotFoundError` (reused) — symbol is not on the watchlist. Maps to **404**.

## Use-case (`engine`)

`BackfillService(sources, candles, watchlist)`:

- `backfill(id, period, range?, onProgress?) → BackfillSummary` —
  1. load the watched symbol (`SymbolNotFoundError` if absent);
  2. require `period ∈ symbol.periods` (`CandleError` otherwise);
  3. resolve the owning source by `symbolType(id)`, `fetchCandles(id, period, range)`
     (deepest history when `range` is omitted);
  4. persist in fixed-size chunks (500), calling `onProgress({ saved, total })` after
     each chunk;
  5. return `{ id, period, from, to, fetched, saved }`, where `from`/`to` are the first
     and last persisted candle `time` (`null` when nothing was fetched).
- `read(id, period, range) → Candle[]` — delegate to `candles.range` (for the GET).

## Acceptance criteria (each → one unit test, full-payload `toEqual`)

Domain (`core`):

- [ ] `parseBackfillRange({ from: 1000, to: 2000 })` returns `{ from: 1000, to: 2000 }`.
- [ ] `parseBackfillRange(undefined)` returns `undefined` (⇒ provider-max history).
- [ ] `parseBackfillRange` throws `CandleError` when `from >= to`.
- [ ] `parseBackfillRange` throws `CandleError` when `from`/`to` is not a finite number.

Application (`engine`, fake sources + fake `CandleRepository` + fake `WatchlistRepository`):

- [ ] `backfill` fetches from the owning source and persists every candle; returns
      `{ id, period, from, to, fetched, saved }` with `fetched === saved === N` and
      `from`/`to` = first/last persisted candle `time`.
- [ ] `backfill` with no range fetches the source's full history (passes `undefined`
      through to `fetchCandles`) and persists it.
- [ ] `backfill` reports progress per 500-candle chunk: for 1200 candles `onProgress`
      is called with `{ saved: 500, total: 1200 }`, `{ saved: 1000, total: 1200 }`,
      `{ saved: 1200, total: 1200 }`.
- [ ] `backfill` throws `SymbolNotFoundError` and persists nothing when the id is not
      watched.
- [ ] `backfill` throws `CandleError` and persists nothing when `period` is not among
      the watched symbol's periods.
- [ ] `read` returns the stored candles for the range (ascending by `time`).

Port contract — `runCandleRepositoryContract` (shared; fake in unit, Mongo in e2e):

- [ ] after `save`, `range` returns the saved candles ascending by `time`.
- [ ] `save` is idempotent: re-saving the same `time` replaces it (no duplicate).
- [ ] `latest` returns the highest-`time` candle, and `null` when empty.

Driving adapters:

- [ ] CLI `candles backfill <id> --period 1h [--from <ms> --to <ms>]` prints progress
      lines and a final summary JSON (range optional ⇒ full history).
- [ ] CLI `candles list <id> --period 1h [--from <ms> --to <ms>]` prints candles JSON.
- [ ] API `POST /symbols/{id}/backfill` `{ period, from?, to? }` → 200 summary;
      not watched → 404; period-not-watched / bad range → 400.
- [ ] API `GET /symbols/{id}/candles?period=&from=&to=` → 200 with the candles.
- [ ] API WS `GET /symbols/{id}/backfill/progress`: a client subscribed before a
      backfill receives `{ saved, total }` progress frames and a final `{ summary }`
      frame. The application stays callback-based; a small in-API `BackfillProgressHub`
      fans `onProgress` out to subscribers (engine has no WS dependency).

## End-to-end expectation

API e2e over **real Mongo** (Testcontainers) with a **stub `MarketDataSource`** seeded
with a fixed candle series (no third-party API in CI):

- Happy path: `POST /symbols` a stub-known id → 201; open the WS
  `…/backfill/progress`; `POST /symbols/{id}/backfill` `{ period }` → 200
  `{ fetched: N, saved: N }`; the WS receives progress frames then a `summary` frame;
  `GET …/candles` → 200 with the N candles ascending by `time`. (WS test runs against a
  real listening server — Node's global `WebSocket` client — not `inject`.)
- Critical failure mode: `POST /symbols/{id}/backfill` for an **unwatched** id → 404
  and nothing is persisted (`GET …/candles` stays empty).

Real Binance/Yahoo `fetchCandles` is covered by the shared `MarketDataSource` contract
in the `live` tier.

## Out of scope (later slices / not now)

- Continuous polling and resume-from-latest (slice 3); `latest()` is added now only so
  slice 3 can resume. Backfill progress IS streamed over WebSocket here, but live
  *candle* streaming to watchers is slice 3. The engine emits progress as an
  `onProgress` callback; WS is purely an API-adapter rendering of it.
- Indicators/signals/backtests over the stored candles.
- Gap detection / re-fetch of missing windows; rate-limit/backoff tuning of adapters.
- Bonds.
