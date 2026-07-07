# Spec: per-observation indicator compute memo in the rule engine

- Status: draft
- Touches: `wireRuleEngine` serializer, `RuleOrchestrator.process`, `TriggerDispatcher.buildContext`, `buildEvaluationContext`, `IndicatorSeriesStore.series`, `PagedIndicatorSeriesView` — plus a new `IndicatorComputeCache` seam.

## Goal

For every candle the rule engine fans one observation into several trigger events (`BarOpened` / `BarClosed` / `Tick`, plus one per matching rule), and each event builds a fresh, uncached evaluation context.
So a shared indicator operand recomputes `IndicatorService.compute` once per event with byte-identical arguments — pure waste on the hot live path (#548).
Memoize the compute read within a single observation so those identical calls collapse to one, without leaking a stale result into the next bar.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] A per-observation compute memo returns the memoized result for a repeated `(symbolId, indicatorKey, inputs, period, from, to)` identity, running the underlying compute exactly once.
- [ ] The same memo runs the underlying compute again for a different identity (a different window), so distinct reads are never conflated.
- [ ] Driving one candle that fans into `BarOpened` + `BarClosed` + `Tick` over rules referencing the same indicator operand invokes `IndicatorService.compute` exactly once (was once per event).
- [ ] Advancing to the next bar recomputes: a fresh observation with a wider window issues a second `IndicatorService.compute`, so the memo never leaks a stale result across bars.

## End-to-end expectation

Live path (and, because backtest replay wires through the same `wireRuleEngine`, the backtest path too): a single candle drives multiple trigger events over a shared SMA operand and the engine issues one `IndicatorService.compute`; the very next candle — a distinct observation with an advanced upper bound — issues a fresh compute.
Critical failure mode guarded by existing coverage: a compute that throws (unwatched symbol / bad inputs) still ends the operand's walk cleanly; the memo caches by a tightly-scoped, per-observation identity that dies with the batch, so nothing survives to leak into the next bar.

## Out of scope

- No change to any HTTP / WebSocket surface — this is an internal hot-path optimization, so no README or DTO changes.
- No cross-observation / persistent cache: lifetime is exactly one `EventBatch`.
- No `Proxy`, no method-name interception, no per-consumer/per-drain memo (the rejected alternative documented separately under #550).

## Surprises

(filled retroactively)
