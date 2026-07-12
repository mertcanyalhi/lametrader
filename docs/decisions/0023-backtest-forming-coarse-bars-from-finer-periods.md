# Backtest synthesizes forming coarse bars from finer periods

- Status: accepted

## Context

The platform ingests candles, not trades, and a coarse bar becomes visible to the rule engine only once it has closed: the backtest feed withholds each candle until its completion time (`orderBacktestFeed`), and live polling persists a bar on close.
Between closes, a coarse-period OHLCV operand therefore reads the **previous** closed bar.

For a symbol watched on both a fine and a coarse period (e.g. 1m + 1h), this means a rule on the 1h `Close` sees nothing move for an hour at a time, even though the 1m candles that compose the forming hour are already being replayed tick by tick.
A user backtesting a multi-timeframe strategy expects the higher-timeframe operand to track intrabar, the way a real forming bar does on a live chart.

This conflicts with a deliberate live invariant (ADR-0016: no synthesised bars; each poll is the tick; coarse bars exist only once closed).
Changing it live would alter when every coarse-period rule fires and needs its own scrutiny.

## Decision

Synthesize the forming coarse bar in the **backtest replay only**, behind an opt-in.

- A new `FormingBarSeriesView` (`analytics/rules/bar-series-view.ts`) rolls the finest observed period's candles inside the current, not-yet-closed coarse window up into a synthetic bar — open = oldest fine open, high/low = window extremes, close = newest fine close, volume = window sum — and **layers** it as the newest point on top of the closed coarse history (served by an inner `PagedBarSeriesView` bounded strictly below the window open).
  This is layering, not fallback: `FallbackSeriesView` only stands in when the primary is empty, so it could not surface a forming bar once closed history exists.
- `buildLiveBarSeries` gains an opt-in parameter; when set, each coarse `(period, axis)` whose finest observed period is strictly finer is wrapped in a `FormingBarSeriesView` fed by that finest period. Off by default, so live keeps close-only coarse bars.
- `RuleEngineDeps.formIntrabarCoarseBars` threads the flag; `BacktestReplayService` sets it `true`, live wiring leaves it unset.

The finest observed period feeds every coarser period's forming bar, mirroring the existing "finest watched period mints the tick" rule (ADR-0016 / commit 5e47f9f).

## Consequences

- Single-period backtests are unaffected (the wrap engages only when a strictly-finer period is also active), so existing replay results and their tests are unchanged.
- Multi-timeframe backtest results now differ from before: a coarse rule can fire intrabar. This is the intended behavior change and is scoped to backtests.
- Per-axis window aggregation is recomputed per axis per firing observation (O(fine candles × 5)); memoizing across axes is the upgrade path if profiling flags it.
- Extending forming coarse bars to the live engine remains a separate, ADR-worthy decision precisely because it changes production rule firing.
