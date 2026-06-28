# Spec: rules-v2 series store + EvaluationContext

- Status: draft
- Touches: `@lametrader/engine` — new `rules-v2/` submodule.

## Goal

History surface every series-aware v2 operator (Crossing, Channel, Moving) reads from, plus the `EvaluationContext` interface every leaf evaluator consumes.
Hybrid storage per ADR 0016: bars live in the existing `CandleRepository` (no duplication), ticks in an in-memory ring buffer per symbol (ephemeral), indicator state in-memory and rebuildable from bars via the existing `IndicatorService.compute(...)`.

## Acceptance criteria

Each bullet maps to exactly one unit test.

- [ ] `TickRingBuffer.push(ts, value)` then iterating backward yields the inserted samples newest-first.
- [ ] `TickRingBuffer.asOf(ts)` returns the latest sample with `sample.ts <= ts` (step-function lookup); returns `null` when no sample exists at or before `ts`.
- [ ] `TickRingBuffer` evicts the oldest sample once `capacity` is reached (FIFO; the cap is a documented constant on the class).
- [ ] `barSeries(repo, symbolId, period, axis, window)` returns a `SeriesView` whose samples are the candle window's per-axis values (`open` / `high` / `low` / `close` / `volume`) ascending by `ts`.
- [ ] `IndicatorSeriesStore.rebuild(instance)` loads the candle history via the injected `IndicatorService.compute(...)` and caches one numeric series per state-key, keyed by `(instanceId, stateKey)`.
- [ ] `IndicatorSeriesStore.appendForBar(instance, ts)` computes the single-bar window via the same `IndicatorService.compute(...)` and appends the new point — the resulting series equals a fresh full rebuild over the same candle range.
- [ ] `EvaluationContext.resolveLatest(operand)` returns the latest `StateValue` for every operand kind from #388 — `Price` (tick ring), OHLCV (bar series), `IndicatorRef` (indicator store), `SymbolStateRef` / `GlobalStateRef` (state repo), `Literal` (operand value).
- [ ] `EvaluationContext.resolveSeries(operand)` returns a numeric `SeriesView` for series-eligible operands (`Price`, OHLCV, `IndicatorRef`) and `null` for non-numeric / non-series operands (state-refs, non-numeric indicator state-keys, `Literal`).

## End-to-end expectation

Out of scope for this slice — `EvaluationContext` is consumed by operators that land in #392.
The integration gate here is `npm run check` green; the e2e path is exercised in a later slice once the operator dispatcher exists.

## Out of scope

- v2 operator implementations (Crossing / Channel / Moving / Comparison / State) — own issue (#392).
- v2 trigger evaluator / orchestrator wiring — own issues (#393 / #394).
- Cross-symbol operand references — explicitly rejected at design time (ADR 0016).
- Persisting tick history — ticks are ephemeral by nature (CONTEXT.md / ADR 0016).

## Surprises

(empty for now)
