# Spec: Backtest forming coarse bars from finer periods

- Status: implemented
- Touches: `analytics/rules/bar-series-view` (new `FormingBarSeriesView`), `analytics/rules/wire/wire-rule-engine` (opt-in series wiring), `analytics/backtesting/backtest-replay.service` (opt-in flag)

## Goal

During a backtest, let a coarse-period OHLCV operand (e.g. a `Close` on a 1h interval) track the **forming** bar rolled up from the finer candles observed so far in the current, not-yet-closed window — instead of reading the last *closed* coarse bar.
The live engine is unchanged (coarse bars still appear only on close); this is a backtest-only opt-in.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] `FormingBarSeriesView` synthesizes the forming coarse bar from the fine candles in the current window: open = oldest fine open, high/low = window extremes, close = newest fine close, volume = window sum.
- [ ] `FormingBarSeriesView` layers the forming bar as the newest point on top of the closed coarse history behind it (it is not a fallback that only stands in when history is empty).
- [ ] `FormingBarSeriesView` reads the last closed coarse bar when the current window holds no fine candle yet.

## End-to-end expectation

A backtest replay over a symbol watched on both 1m and 1h, with a rule comparing the 1h `Close` against a threshold on every tick: the rule fires **intrabar** — on the finer tick at which the forming 1h close first crosses the threshold — rather than only once the hour closes.
Critical negative: with only closed coarse history (no finer candle in the current window), the coarse operand resolves to the last closed bar and the rule does not fire early.

## Out of scope

- Any change to live/production signal semantics — the flag defaults off; only the replay sets it.
- A per-coarse-period choice of fine source: the finest observed period feeds every coarser period's forming bar.
- Memoizing the per-axis window aggregation across the five axes (recomputed per axis today).

## Surprises

- `FallbackSeriesView` could not carry this: it only stands in when the primary is *entirely empty*, so once any closed coarse bar exists the forming bar would never show. A dedicated *layering* view was needed.
