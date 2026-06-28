# Spec: rules-v2 series store + EvaluationContext

- Status: draft
- Touches: `@lametrader/engine` — new `rules-v2/` module: `TickRing`, `BarSeriesView`, `IndicatorSeriesStore`, and `EvaluationContext` (live + in-memory) on top of existing `CandleRepository` + `IndicatorService`.

## Goal

Provide the read-side history surface that the v2 series-aware operators (Crossing, Channel, Moving — implemented in #391) consume, plus the `EvaluationContext` interface every operator calls.
Hybrid storage per ADR 0016: bars read live from the existing `CandleRepository` (no duplication); ticks held in a per-symbol bounded in-memory ring buffer (ephemeral by design); indicator series held in-memory and rebuilt from candle history at startup via `IndicatorService`.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] `TickRing.push(ts, price)` appends a tick; `backwardWalk()` yields the pushed points newest-first.
- [ ] `TickRing.asOf(ts)` returns the latest tick with `ts <= queryTs`, or `null` when none qualify.
- [ ] `TickRing` capped at `TICK_RING_CAPACITY` (1024) per symbol — pushing beyond the cap evicts the oldest tick first (length stays bounded).
- [ ] `BarSeriesView.forAxis('close')` over `(symbolId, period, [from, to))` resolves to the close value per bar, newest-first on `backwardWalk()`, with `length` matching the candle count in window.
- [ ] `BarSeriesView.asOf(ts)` returns the OHLCV-axis value of the latest bar with `time <= ts`, or `null` when none qualify in window.
- [ ] `IndicatorSeriesStore.warmup(instanceId, …)` rebuilds the series from candle history at startup; `latest(instanceId, stateKey)` returns the most-recent computed row's value before any new bar arrives.
- [ ] `IndicatorSeriesStore.onBar(instanceId, candle)` appends one row and bumps `latest()` so it matches what a deterministic SMA would compute over the same warmup + new bar combined.
- [ ] `EvaluationContext.resolveLatest(operand)` returns the current `StateValue` for each of the 10 operand kinds (`Price`, OHLCV, `IndicatorRef`, `SymbolStateRef`, `GlobalStateRef`, `Literal`) — `null` when the underlying store has no value yet.
- [ ] `EvaluationContext.resolveSeries(operand)` returns a series view for each series-bearing operand kind (`Price`, OHLCV per-axis, `IndicatorRef` per state-key) supporting `length`, `backwardWalk()`, and `asOf(ts)`.
- [ ] `EvaluationContext.resolveSeries(Literal)` returns a single-point series whose `asOf(any)` returns the literal — Literals are stationary per the resolver contract.

## End-to-end expectation

A `*.e2e.test.ts` drives the happy path end-to-end: build an `EvaluationContext` over an in-memory `CandleRepository` seeded with a deterministic 10-bar history + a profile-attached SMA indicator instance, push a fresh bar through `IndicatorSeriesStore.onBar`, then push a handful of ticks and assert that:
1. `resolveLatest(Price)` matches the last tick, `resolveLatest(Close)` matches the last bar's close, `resolveLatest(IndicatorRef)` matches the SMA over the warmup + new bar.
2. `resolveSeries(Price).asOf(midTickTs)` returns the price as of that timestamp (right-operand resampling shape per ADR 0016).
3. Critical failure mode: querying a series for an unwatched symbol / unbacked operand returns an empty series (not a crash).

## Out of scope

- The operators themselves (Crossing/Channel/Moving live in #391).
- The trigger dispatcher / bridges / orchestrator (#392-#395).
- Tick persistence — ticks are ephemeral by design.
- Cross-symbol references — operands always read from the firing symbol per ADR 0016.
- A real `QuoteStreamService` subscription wiring — that adapter lives in the bridges slice.

## Surprises

(empty for now)
