# Spec: enrich GET /symbols with a per-symbol quote

- Status: implemented
- Touches: `core` (`SymbolQuote`/`EnrichedSymbol` types + pure `computeQuote`), `CandleRepository` port (`latestN`), `engine` (`SymbolService.listWithQuotes`, both candle adapters + shared contract), `api` (`GET /symbols?enrich=true`), `cli` (`symbols list --enrich`).

## Goal

Let `GET /symbols` optionally return a **quote** per watched symbol — latest price, period-over-period change, and change rate — computed server-side from stored candles, so the watchlist UI can show price/change columns from one call.
Opt-in via an `enrich` flag; the default response stays today's plain `WatchedSymbol[]`.

The quote is computed strictly from the symbol's `config.defaultPeriod` candle series (no fallback): `price` is the latest close, `change` is `latestClose − previousClose`, `changePct` is `change / previousClose`, `period` is the `defaultPeriod`, and `time` is the latest candle's open time (epoch ms).
`quote` is `null` when the symbol does not watch `defaultPeriod` or has fewer than two stored candles there.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] `computeQuote(latest, previous)` returns `{ price, change, changePct, time }` for a rising pair (positive change), full-payload `toEqual` with `closeTo` floats.
- [ ] `computeQuote(latest, previous)` returns a negative `change` and `changePct` for a falling pair, full-payload `toEqual` with `closeTo` floats.
- [ ] `SymbolService.listWithQuotes` attaches a `SymbolQuote` (period = `defaultPeriod`) per symbol from the latest two `defaultPeriod` candles.
- [ ] `SymbolService.listWithQuotes` yields `quote: null` for a symbol that does not watch `defaultPeriod`.
- [ ] `SymbolService.listWithQuotes` yields `quote: null` for a symbol watching `defaultPeriod` with fewer than two candles there.
- [ ] `CandleRepository.latestN` returns the most recent `n` candles highest-`time` first, capping at how many exist (shared contract — runs on the in-memory fake here and Mongo in e2e).
- [ ] `GET /symbols?enrich=true` returns each item as `{ ...WatchedSymbol, quote }` (full-payload).
- [ ] `GET /symbols` and `GET /symbols?enrich=false` return the plain `WatchedSymbol[]` unchanged (no `quote` field).
- [ ] `symbols list --enrich` prints the watchlist enriched with quotes (drives `listWithQuotes`); plain `symbols list` prints the plain watchlist unchanged.

## End-to-end expectation

E2e (API over real Mongo): backfill a symbol on the default period (≥ 2 candles), then `GET /symbols?enrich=true` returns the expected `price`/`change`/`changePct`/`period`/`time`.
Critical failure mode: a watched symbol with no `defaultPeriod` data yields `quote: null` (rather than erroring).

## Out of scope

- Live updates of the quote via `/stream` (separate task).
- The watchlist page UI (separate task).
- Volume / extra columns, intraday vs session-close nuances, multi-period quotes.

## Surprises

- The `GET /symbols` 200 response schema is a per-item `Type.Union([WatchedSymbolSchema, EnrichedSymbolSchema])`.
  Both schemas set `additionalProperties: false`, so fast-json-stringify discriminates by the presence of `quote` — a plain item (no `quote`) matches `WatchedSymbol`, an enriched item (extra `quote`) only matches `EnrichedSymbol`.
  This keeps both the default and enriched payloads honest under one route without a union of arrays.
- Docker was unavailable in the implementation sandbox, so the e2e tier (Testcontainers Mongo) was not run locally — it is covered by CI's `check:full`.
  The unit tier (298 tests) and `npm run check` are green.
