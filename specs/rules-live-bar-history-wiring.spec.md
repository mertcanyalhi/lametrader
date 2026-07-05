# Spec: rules — warm a real multi-bar OHLCV series into the live evaluation context

- Status: draft
- Touches: `wireRuleEngine` (engine), `TriggerDispatcher.buildContext` (engine), `LiveEvaluationLookups` (engine), `prewarmBarSeries` (engine).

## Goal

Series-aware operators (`Moving`, and its siblings `Channel` / `Crossing`) never fire in the live engine because the OHLCV bar series handed to operators contains exactly **one point** — the latest candle.
In production wiring `wire-rule-engine.ts` `buildContext` passes `barSeries: lookups.bookSeriesFor(firingSymbolId)`, which emits a single-point `ArraySeriesView([point])` per `(period, axis)`.
Any operator that walks backward for prior bars finds nothing behind the newest point, so `evaluateMoving` short-circuits at its `series.length < lookbackBars + 1` guard and always returns `false` (issue #499).

The correct multi-bar path already exists but is unused in production: `prewarmBarSeries` (`evaluation-context.ts`) loads a real window from the `CandleRepository` via `BarSeriesView.load` → `repo.range`.
This fix wires it in: `buildContext` warms a real multi-bar series (all stored bars over every observed `(period, axis)`) from the candle repository, so series operators observe the history that already exists behind the repository.

Because the fetch is async and the operator contract is synchronous, `buildContext` becomes async and the dispatcher awaits it once per fan-out target.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] `LiveEvaluationLookups.observedPeriods(symbolId)` returns the distinct periods recorded for that symbol via `recordCandle`, and `[]` for an unseen symbol.
- [ ] `wireRuleEngine` fires a `MovingUp` rule (`lookbackBars: 1`) end-to-end when the candle repository holds two bars whose close delta exceeds the threshold — proving the live bar series is a real multi-bar window, not a single point.
- [ ] `wireRuleEngine` does **not** fire the same `MovingUp` rule when the close delta across the lookback window is below the threshold (negative control, same wiring path).

## End-to-end expectation

Boot the real Nest app, watch a symbol on the 1m period, and start the dormant rule engine.
Persist a run of 1m candles into the candle repository, create a `MovingUp` rule (`lookbackBars`, threshold) on that symbol, then feed a closing bar whose close lifts the operand by more than the threshold across the lookback window.
The rule fires (`Fired` + `StateSet` in the rule-event log).
A control rule whose threshold is never met stays silent.

## Out of scope

- Precise per-rule window sizing (`lookbackBars × interval` / `latestN`): the warm loads the full stored window per observed `(period, axis)`, which is correct for every lookback and for the unbounded-lookback siblings (`Channel` / `Crossing`).
  Bounding the window to each rule's declared lookback is a later performance upgrade, not a correctness gap.
- `Channel` (#500) and `Crossing` (#501): they ride the same wiring change landed here and get their own operator-level proofs in their issues.
- A new architectural decision (no ADR — this fills a wiring gap the existing "Upgrade path" comment already named).

## Surprises

(filled retroactively)
