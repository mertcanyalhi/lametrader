# Spec: candle reads — keyset pagination

- Status: approved
- Touches: `core` (`CandlePage` type, `parseCandleLimit` + limit constants,
  `CandleRepository.range` gains a `limit`), `engine` (`BackfillService.read`
  returns a page with a cursor; in-memory + Mongo `range` honor `limit`), `cli`
  (`candles list --limit`), `api` (`GET …/candles` accepts `limit`, returns a page).

## Goal

Reading stored candles must not return an unbounded range — a symbol+period can hold
millions of candles. Page the read with a bounded `limit` and a **keyset cursor on
`time`** (stable and index-friendly, unlike offset paging on a large series).

## Domain model

- **`CandlePage` = `{ candles: Candle[]; nextCursor: number | null }`** — one page of
  candles (ascending by `time`) plus the `time` to pass as the next page's `from`, or
  `null` when the page is the last.
- **Limit** — candles per page. `DEFAULT_CANDLE_LIMIT = 100`,
  `MAX_CANDLE_LIMIT = 1000`. A request omitting it gets the default; one over the max
  is rejected at the boundary.
- Paging is **forward, keyset on `time`**: a page covers `[from, to)` ascending, at
  most `limit` candles. `nextCursor` is the `time` of the first candle *not* included
  (so the client re-issues with `from = nextCursor`); `null` if none remain.

## Ports

- `CandleRepository.range(symbolId, period, from, to, limit?)` — gains an optional
  `limit`; when set, returns at most `limit` candles (still ascending by `time`).

## Use-case (`engine`)

`BackfillService.read(id, period, { from, to, limit }) → CandlePage`:

1. fetch `limit + 1` candles via `range` (the extra row probes for a next page);
2. if more than `limit` came back, return the first `limit` and set
   `nextCursor = candles[limit].time`; otherwise return all with `nextCursor = null`.

## Acceptance criteria (each → one unit test, full-payload `toEqual`)

Domain (`core`):

- [ ] `parseCandleLimit(undefined)` returns `DEFAULT_CANDLE_LIMIT` (100).
- [ ] `parseCandleLimit(10)` returns `10`.
- [ ] `parseCandleLimit` throws `CandleError` on a non-integer / `< 1` value.
- [ ] `parseCandleLimit` throws `CandleError` when above `MAX_CANDLE_LIMIT` (1000).

Port contract — `runCandleRepositoryContract` (fake in unit, Mongo in e2e):

- [ ] `range` with a `limit` returns at most that many candles, the lowest-`time`
      first (ascending).

Application (`engine`):

- [ ] `read` returns `{ candles, nextCursor }` with `nextCursor = null` when the stored
      candles fit within `limit`.
- [ ] `read` returns the first `limit` candles and `nextCursor` = the next candle's
      `time` when more remain; paging with `from = nextCursor` yields the remainder.

Driving adapters:

- [ ] CLI `candles list <id> --period 1h [--limit N]` prints `{ candles, nextCursor }`.
- [ ] API `GET /symbols/{id}/candles?period=&from=&to=&limit=` → 200 with
      `{ candles, nextCursor }`; `limit` over the max → 400.

## End-to-end expectation

API e2e (real Mongo): backfill N candles, then `GET …/candles?limit=k` (k < N) returns
the first `k` ascending with a non-null `nextCursor`; re-issuing with `from=nextCursor`
returns the remainder with `nextCursor = null`.

## Out of scope

- Descending / most-recent-first reads, total counts, `Link` headers (the JSON
  envelope carries the cursor). Offset/page-number paging (keyset only).
