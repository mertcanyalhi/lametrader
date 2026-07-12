> **Archived.** The live-chart-during-run behaviour this spec described was removed when backtesting moved to an in-memory replay with a poll-for-result UI (ADR-0022, issue #565). Kept for history.

# Spec: synthesize the forming bar of a larger period from smaller-period stream data

- Status: implemented
- Touches: `packages/ui/src/lib/aggregate-candles.ts` (pure helper), `packages/ui/src/lib/hooks/candles.ts` (`useSyntheticFormingBar`, `useBacktestSetupCandles`), `packages/ui/src/pages/backtesting/idle-backtest-chart.tsx` wired into `backtesting-page.tsx`. `CandleChart` and `/chart` are untouched.

## Goal

The backend polls, stores, and streams candles **per period independently**, only for the periods in `symbol.periods` that were backfilled — there is no candle roll-up.
So when the user selects a **larger** period that was never backfilled, the chart is empty even though the symbol's **smaller** period is streaming live.

Populate the larger period's **latest (forming) bar only** by folding the smaller period's live candles into the current larger bucket.
Historical larger-period bars stay empty until backfilled — this deliberately does **not** synthesize history.

## Acceptance criteria

**Aggregation** — `aggregate-candles.test.ts`, full-payload `toEqual`, one per bullet:

- [x] Folds multiple smaller candles in one larger bucket into a single forming bar: `time` = bucket start, `open` = first-in-bucket open, `high` = max high, `low` = min low, `close` = last close, `volume` = sum.
- [x] A single smaller candle in the bucket yields a forming bar equal to that candle re-timed to the bucket start (same OHLC, volume carried through).
- [x] Empty input yields `null` (nothing to synthesize).
- [x] Only the candles in the **most-recent** bucket are folded — older candles that fall in an earlier larger bucket are excluded (bucket-boundary case).
- [x] The bucket start is the floor of the latest candle's time to the larger period boundary via `periodMillis` (a candle exactly on a boundary opens a new bucket).
- [x] Sums crypto-specific `quoteVolume` and `trades` alongside `volume`; carries an FX (volume-less) candle through with no volume field.

**Wiring** — `candles.test.ts` (hook) + `idle-backtest-chart.test.tsx` (chart), full-payload:

- [x] `useBacktestSetupCandles` passes a period through unchanged and issues no smaller-period seed fetch when it has its own candles (normal case, zero behavior change).
- [x] For a larger period with no native candles it REST-seeds the current bucket from the smaller period and exposes a single synthesized forming bar.
- [x] A live smaller-period stream frame re-folds the forming bar (its `high`/`low`/`close` update).
- [x] The idle backtesting chart feeds the synthesized forming bar into `CandleChart`'s normal `candles` prop; a period with its own data feeds those unchanged.

## Chosen wiring (A2 + B2)

**Surface (A2)** — on the backtesting page, when idle (no run/loaded view) with a symbol selected, `<ChartPlaceholder>` is replaced by `<IdleBacktestChart>`, a live `CandleChart` for the selected symbol + period.
The placeholder now shows only when no symbol is selected (empty watchlist).

**Data source (B2)** — `useSyntheticFormingBar` seeds the current bucket over REST (`fetchRangeCandles(id, smallerPeriod, bucketStart, now)`) so the forming bar's open/high/low are correct even mid-bucket, then folds each live smaller-period stream frame through `formingBucketCandle`.

**Additive, not a `CandleChart` change** — the aggregation happens upstream in the hook; `CandleChart` receives a plain `Candle[]` and is untouched, so `/chart` and the run/loaded charts behave exactly as before.

## End-to-end expectation

Idle backtesting chart for a symbol whose selected (larger) period was never backfilled but whose smallest period streams live: the chart shows exactly one live forming bar whose OHLCV is the aggregate of the small-period frames in the current larger bucket, updating as frames arrive.
Critical passthrough: a period that DOES have its own candles renders them unchanged with no seed fetch and no aggregation.

## Out of scope

- Synthesizing **historical** larger-period bars (only the forming/latest bar is synthesized; history stays empty until backfilled — accepted by the user).
- Any change to the backend (no roll-up added server-side).
- The main `/chart` page and `CandleChart` itself — both untouched; the run/loaded backtest charts behave exactly as before.

## Surprises

- No surface previously rendered a live chart for an empty larger period, so wiring meant turning the backtesting idle `ChartPlaceholder` into a live chart — a deliberate behavior change (A2), which updated two picker assertions in `backtesting-page.test.tsx` (idle+selected now shows the chart, not the placeholder).
