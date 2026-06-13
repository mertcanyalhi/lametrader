# Spec: source-period capability

- Status: approved
- Touches: `core` (`MarketDataSource` port gains `periods`), `engine`
  (Binance/Yahoo/in-memory sources, `SymbolService.add`/`setPeriods`).

## Goal

A symbol's periods are validated against the **global config** today, but not
against what the **owning source** can actually serve. Yahoo has no 4h bar, so a
stock watched at `4h` (when config enables `4h`) is accepted, then fails only later
with a 400 at backfill time. Capability is a property of the source and should be
checked when the watch is established.

## Domain model

- `MarketDataSource` gains `readonly periods: Period[]` — the periods that source
  can fetch candles at. Binance: all eight. Yahoo: all but `4h`. The in-memory
  source: all by default (overridable for tests).

## Acceptance criteria

- `SymbolService.add` rejects (with `SymbolError`, persisting nothing) when any
  resolved period is not in the owning source's `periods`.
- `SymbolService.setPeriods` rejects the same way.
- `add`/`setPeriods` still succeed when every resolved period is supported by both
  the config and the source.
- The shared `MarketDataSource` contract asserts the source declares a non-empty
  `periods` that includes the contract's probe `candlePeriod`.
- E2E: over HTTP, `POST /symbols` for a period enabled in config but not served by
  the owning source is rejected with **400** (`source does not support …`) and
  persists nothing.
