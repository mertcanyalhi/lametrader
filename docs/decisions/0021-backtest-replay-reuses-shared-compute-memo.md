# Backtest replay reuses the shared engine compute memo, not a per-consumer Proxy

- Status: accepted

## Context

Within one candle the rule engine fans a single observation into several trigger events (`BarOpened` / `BarClosed` / `Tick`, plus one per matching rule), each building a fresh evaluation context.
A shared indicator operand read by every one of those events would recompute `IndicatorService.compute` once per event with byte-identical arguments (#548).
The fix (#548, merged as #552) is a threaded per-observation compute memo: `wireRuleEngine` creates one fresh `IndicatorComputeCache` per event batch inside the per-symbol serializer step and threads it — `buildContext` → `buildEvaluationContext` → `IndicatorSeriesStore.series` → `PagedIndicatorSeriesView` — so every trigger event of one observation shares a single compute per `(symbolId, indicatorKey, inputs, period, from, to)` identity.

The backtest replay path (`BacktestReplayService.replay`) has the identical per-event redundancy.
Crucially, it wires its throwaway engine through the **same** `wireRuleEngine`, so #548's shared seam already dedups the backtest path with no backtest-local change.

Issue #550 records a tempting but rejected way to have addressed the backtest path *locally*, before #548 existed: wrap the shared `IndicatorService` in a `Proxy` that memoizes `compute` within a single candle's drain, keyed on the call args and cleared per candle.
It documents why that per-consumer memo must not be adopted; it proposes no runtime change.

## Decision

The backtest replay path relies on the shared engine per-observation compute memo (#548 / #552); it introduces **no** per-consumer `Proxy` memo of its own.

`BacktestReplayService` stays a plain consumer of the shared `wireRuleEngine`: it constructs an `IndicatorSeriesStore` over the shared `IndicatorService` and the candle store, wires the engine, and feeds candles — the serializer owns and threads the compute memo exactly as it does for the live path.
This is locked by a backtest-perspective regression test asserting that the trigger events one replayed candle fans out drive exactly one `IndicatorService.compute`, plus a guard asserting the service source carries none of the rejected constructs (`Proxy`, `memoizeCompute`, method-name interception on `'compute'`, a `JSON.stringify` cache key).

## Considered Options

**Shared engine per-observation memo (chosen).**
A typed `IndicatorComputeCache` seam threaded from the serializer through the evaluation context to the pager.
One fix dedups both the live and backtest paths because both wire through `wireRuleEngine`; the key is the meaningful compute identity, and the cache object is created and owned by the serializer's per-batch step, so its per-observation lifetime is structural rather than an invariant a caller must remember to honour.

**Per-consumer `Proxy` memo on the backtest path (rejected).**
Wrapping `IndicatorService` in a `Proxy` that memoizes `compute` per drain, cleared each candle from the replay loop.
Rejected for the five problems #550 enumerates, each of which the shared seam avoids:

1. **Wrong layer.** A per-consumer memo hides the redundancy in one caller while the live path still recomputes, so two paths handle one root cause inconsistently. — The shared seam fixes the redundancy once, in the engine, for every consumer.
2. **Opaque method-name interception.** A `Proxy` keyed on `prop === 'compute'` silently disables itself if `compute` is renamed — a quiet regression to the slow path, reaching through a shared service's public surface from a consumer. — The shared seam is an explicit, typed `IndicatorComputeCache` port the pager calls; a rename is a compile error.
3. **Brittle `JSON.stringify(args)` key.** Depends on argument order, on whether the optional trailing `range` is present, and on `inputs` key ordering; a non-serializable argument throws inside the memo. — The shared seam keys on an explicit `IndicatorComputeKey` (scalar fields joined on a `NUL` separator, `inputs` normalized to sorted pairs), a narrow checkable identity.
4. **Caching rejections.** A failed `compute` cached for the rest of a drain re-throws for every later identical call — an implicit behaviour invisible at the call sites. — The shared seam memoizes the promise per observation with the same trade-off, but scoped and documented at the seam rather than hidden behind an interceptor.
5. **Unenforced per-drain lifetime.** Correctness would depend on clearing the cache exactly once per candle from the replay loop, with the cache and the clearing code in separate places and nothing in the types guaranteeing it. — The shared seam creates a fresh cache object per batch owned by the serializer step, so the lifetime is structural and a per-symbol concurrent batch cannot leak into another.

## Consequences

- The backtest path gains the #548 dedup for free; a future change to the shared memo benefits both paths at once.
- The regression + guard tests fail if the backtest path ever regresses to per-event recompute or grows a backtest-local `Proxy`, keeping the decision executable rather than only documented.
- Reference: #548 (live-path memo), #552 (its merge), #550 (this rejected alternative).
