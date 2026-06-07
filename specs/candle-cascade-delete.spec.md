# Spec: removing a symbol cascades to its candles

- Status: approved
- Touches: `core` (`CandleRepository.deleteSymbol`), `engine` (`SymbolService`
  gains a `CandleRepository`; `remove` cascades; in-memory + Mongo adapters
  implement `deleteSymbol`).

## Goal

Removing a symbol from the watchlist must also delete its stored candles (all
periods). Today `SymbolService.remove` only deletes the watchlist entry, leaving
orphaned candle documents in Mongo forever.

## Domain model / ports

- `CandleRepository.deleteSymbol(symbolId)` — delete every stored candle for the
  symbol, across all periods. Idempotent (no-op when none exist).
- `SymbolService.remove(id)` — remove the watchlist entry **and** call
  `candles.deleteSymbol(id)`. The service gains a `CandleRepository` dependency.

## Acceptance criteria (each → one unit test, full-payload `toEqual`)

Port contract — `runCandleRepositoryContract` (fake in unit, Mongo in e2e):

- [ ] after `deleteSymbol(id)`, a `range`/`latest` for that symbol (any period)
      returns nothing — and candles for *other* symbols are untouched.

Application (`engine`):

- [ ] `remove(id)` deletes the watchlist entry and the symbol's candles (the
      injected candle repo's `deleteSymbol` is invoked for the id).

## End-to-end expectation

API e2e (real Mongo): backfill a watched symbol, `DELETE /symbols/{id}` → 204, then
`GET …/candles` returns an empty page — the candles are gone, not orphaned.

## Out of scope

- Per-period deletion (removing one period from a watched symbol). Cascade is
  all-or-nothing on full symbol removal.
- Soft-delete / archival.
