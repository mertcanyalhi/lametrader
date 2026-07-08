# Spec: Backtest replay rolling window

- Status: draft
- Touches: `packages/ui` chart viewport — `CandleChart` (new `follow` prop) + `chart-viewport.ts` helper, wired from `backtesting-page.tsx`.

## Goal

During backtest replay the chart should track the newest candle in a rolling, fixed-width window instead of zooming out to fit the whole growing series.
Default the window to ~20 candles; when the user widens it, keep following the newest bar at their chosen width.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] `rollingWindowBars` returns the default (20) when the chart reports no visible range yet (`null`).
- [ ] `rollingWindowBars` adopts the user's current width (`to - from + 1`) when they've widened past the default.
- [ ] `rollingWindowBars` floors at the default (20) when the user's current width is narrower.
- [ ] In follow mode, setting candles frames the last-20-bars logical window via `setVisibleLogicalRange`.
- [ ] In follow mode, appending a candle moves the window forward to keep the newest bars in view.
- [ ] In follow mode, when the visible window is wider than the default, the next candle re-frames at the user's wider count, not 20.
- [ ] Without follow mode, candle growth does not re-frame the viewport (existing restore behaviour preserved).

## End-to-end expectation

The backtesting page passes `follow` to its chart; as replay frames append candles the visible window tracks the newest bar at the default 20-bar width (or wider if the user widened it), never fitting the whole series.
The one critical failure mode — a chart that reports no visible range — falls back to the default width rather than crashing.

## Out of scope

- Persisting the replay window (follow mode deliberately does not read or write the shared `chart-viewport` localStorage key).
- Narrowing below the 20-bar default, or "snap back" if the user scrolls into history — the window always tracks the newest bar while replay streams.
- The `/chart` page viewport, which keeps its existing restore/capture behaviour unchanged.

## Surprises

- The visible logical range spans *inclusive* bar indices, so its width in bars is `to - from + 1`; reading it back as `to - from` and re-feeding it drifts the window one bar narrower per frame. The `+1` correction in `rollingWindowBars` cancels the `bars - 1` span that `liveLogicalRange` produces, keeping the width stable across frames.
