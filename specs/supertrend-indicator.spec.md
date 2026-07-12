# Spec: Supertrend indicator

- Status: draft
- Touches: `analytics/indicators` (new `supertrend` module + catalog registration); served unchanged over the `/indicators` catalog, the `/symbols/:id/indicators/:key` compute route, and the `/stream` indicator subscription.

## Goal

Add the Supertrend indicator — an ATR-based trailing stop that reads an ongoing trend and fires buy/sell signals when the trend flips.
It is a faithful port of the common TradingView v4 Pine reference (period, multiplier, selectable ATR method), exposed through the existing indicator contract so it needs no new endpoint.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] Computes the aligned `value` / `trend` / `signal` series with the RMA (Wilder) ATR method — warm-up rows all-`null`, then the active band value, the per-bar trend direction, and a `sell` on the down-flip and a `buy` on the up-flip.
- [ ] Computes the same series with the SMA ATR method, which diverges from RMA on the bands once the trailing average differs.
- [ ] Returns an all-`null` series (silently) when the candle input is shorter than `period`.
- [ ] Uses no look-ahead: the truncated-prefix series equals the full series over the same prefix.
- [ ] Defaults are `atrPeriod: 10`, `multiplier: 3`, `source: hl2`, `atrMethod: rma`, and `appliesTo` is every asset class (Supertrend reads no volume, so it applies to FX too).
- [ ] `warmup(inputs)` returns `atrPeriod` — the bar count before the first non-null row.
- [ ] `summary(inputs)` renders a short label, e.g. `Supertrend 10 × 3 hl2 rma`.
- [ ] The definition is JSON-serializable (no function leaks into the metadata).
- [ ] `defaultIndicators()` registers `supertrend` alongside `sma` and `vwma`.

## End-to-end expectation

Seed a watched crypto symbol with a V-shaped candle series, then `GET /symbols/:id/indicators/supertrend?period=…&multiplier=…&atrMethod=…` returns a 200 compute result whose series flips trend and fires at least one `buy` signal (poll/persist stand in as the seeded Mongo candles).
The catalog route `GET /indicators/supertrend` returns the definition; the critical failure mode is the shared one — an unknown symbol returns 404 — already covered by the compute route's watchlist guard.

## Out of scope

- The Pine highlighter fill, the alert conditions, and the chart plot styling — the state fields carry render/pane hints and the chart layer owns rendering.
- A dedicated "direction change" signal — `trend` already exposes the per-bar direction, and `signal` marks the flips.
- Suppressing a signal on the first ATR-defined bar — the port stays faithful to the Pine reference, where the warm-up trend seed of `up` lets the first defined bar fire a `sell` on a down-flip.

## Surprises

- True Range on the first bar has no previous close; it is taken as `high - low` (the standard textbook seed), so ATR is defined from index `atrPeriod - 1`.
- The ATR-length input is keyed `atrPeriod`, not `period`: the compute route (`GET /symbols/:id/indicators/:key`) destructures `period` / `from` / `to` out of the query as the candle sampling period and range bounds, so an input keyed `period` would be swallowed before reaching the indicator (the existing SMA/VWMA sidestep this by keying their length input `length`).
