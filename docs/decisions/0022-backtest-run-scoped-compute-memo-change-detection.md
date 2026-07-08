# Backtest replay extends the shared compute memo to run scope for coarse-bar change-detection

- Status: accepted

## Context

Phase 2 of the streaming backtest feed (`docs/designs/streaming-backtest-feed.md` §7 / §9, issue #556) targets the CPU wall: a 10-year 1-minute replay performs ~5.26M drains, and each drain re-evaluates every per-tick rule from scratch.
The canonical waste is a rule reading a coarse-period indicator operand (an SMA on the 1h series) over a fine feed: the operand's value changes ~once per 60 fine bars, yet `IndicatorService.compute` runs for it on every fine bar, because the shared per-observation compute memo (ADR-0021 / #548) is scoped to a single observation and never spans candles.

The issue leaves the design open on four axes: skip granularity (whole drain vs per-rule vs per-operand), the exact change-detection predicate, how it extends the ADR-0021 seam without reintroducing the #550-rejected per-consumer memo, and whether the predicate is shared with the live path.

Three facts in the engine source settle those axes.

**The compute identity already encodes "did anything this compute reads change".**
`PagedIndicatorSeriesView.backwardWalk` derives each compute window from the newest *visible* candle page — `latestN(symbolId, period, pageSize, before)` with `before = event.ts + 1`, then `[oldest.time, newest.time + 1)` — and keys the seam's `IndicatorComputeKey` on `(symbolId, period, indicatorKey, inputs, from, to)`.
A fine observation that admits no new coarse candle produces a bit-identical coarse page, hence a bit-identical key; the key changes exactly when a new coarse bar enters the visible page.
So "no bar on the operand's period became visible since the last observation" — the predicate the issue sketches as period-closed bookkeeping — is already expressed, more precisely, by key equality.

**A backtest replay's candle read-set is immutable for the run.**
`IndicatorService.compute` is a pure function of its key plus the candles it reads (`latestN(warmup, from)` + `range(from, to)`); a replay only reads the store, over closed historical bars.
Identical key therefore implies identical inputs implies a byte-identical result for the whole run.

**The live path has no such immutability.**
The poll loop re-saves the forming bar under the same `candle.time` on every poll (`CandleRepository.save` upserts by time), and backfill upserts history; in live an identical key does *not* imply identical inputs, so any memo outliving one observation would serve stale forming-bar computes.

## Decision

`BacktestReplayService` extends the shared ADR-0021 compute-memo seam from per-observation to **run** scope; it skips per-operand *computes*, never drains or rule evaluations.

- `RuleEngineDeps` gains an optional `runComputeCache: IndicatorComputeCache`.
  When present, the serializer threads that one instance into every batch instead of creating a fresh `createIndicatorComputeCache()` per batch; the threading path (serializer → orchestrator → dispatcher → `buildEvaluationContext` → `PagedIndicatorSeriesView`) and the typed `IndicatorComputeKey` are unchanged.
  The option's contract is the immutability invariant above: a caller may pass it only when the candles behind every key are immutable for the cache's lifetime.
- A new engine-owned factory, `createRunScopedIndicatorComputeCache(maxEntries)`, sits beside `createIndicatorComputeCache` in `analytics/rules/indicator-compute-cache.ts`: the same serialized-key memo, plus a bounded LRU (re-insertion on hit, oldest-first eviction) so fine-period keys — which legitimately churn once per fine bar — cannot grow the cache over a long run, and eviction of rejected promises on settlement so a transient compute failure is retried on the next observation exactly as the per-observation memo allows.
- `BacktestReplayService.replay` passes `runComputeCache: createRunScopedIndicatorComputeCache()` into `wireRuleEngine` — one wiring line; the replay service holds no memo, no `Proxy`, no method-name interception, no `JSON.stringify` key, so the #553 guard stays green.
- The live wire-up (`connect.ts`) does not set the option and keeps ADR-0021's per-observation lifetime.
  Phase 2 is backtest-scoped **by invariant, not by mechanism**: the seam extension is engine-level and available to any consumer that can guarantee immutability, but live cannot (forming-bar and backfill upserts), so live and backtest share the seam and the key, not the lifetime.

The effect: a coarse operand's compute runs once per coarse-bar visibility change (~once per coarse bar) instead of once per fine observation, while every drain still routes, gates, latches, cascades, logs, and steps the executor exactly as before.
Results are byte-identical because only pure computes behind identical identities are deduplicated.

## Considered Options

**Skip whole drains whose observation "cannot matter" (rejected).**
A drain carries timestamp-dependent semantics that no cheap predicate covers: an `EveryTime` rule with a true condition must fire on every tick, `OncePerInterval` gates compare `event.ts`, `BarOpened` re-arms `OncePerBar` latches, and `BacktestExecutor.processStep` must see every candle for mark-to-market and threshold exits.
Proving a drain unskippable requires evaluating the very conditions the skip is trying to avoid.

**Skip per-rule evaluation when no operand the rule reads changed (rejected).**
The canonical strategy is cross-period — fine price against a coarse indicator — and its fine operand changes on every fine bar, so "no operand changed" never holds and the rule-level skip wins nothing, while still needing per-rule read-set extraction plus tracking of state-slot mutations (rule actions set state between bars) to be safe.
Per-operand compute memoization keeps the full coarse-compute win on exactly those rules, with no read-set bookkeeping at all.

**A period-closed bitmask predicate plus explicit per-period invalidation (rejected).**
Keying invalidation off "which periods closed a bar this observation" duplicates, less precisely, what the compute key's visible-window identity already says — and adds an invalidation path that can be missed.
With key-carried windows, a new visible bar *is* a new key; stale entries are never wrong, only garbage, and the LRU bound collects them.

**Reintroduce a consumer-side memo in the replay service (rejected, again).**
ADR-0021 / #550 already rejected a `Proxy`/`JSON.stringify` memo over `IndicatorService.compute` for five recorded reasons; Phase 2 changes the *lifetime policy* of the existing engine seam instead, and the #553 source guard continues to enforce the rejection.

## Consequences

- The measurable Phase 2 win: over a fine feed with a coarse-indicator rule, `IndicatorService.compute` count drops from ~one per observation to ~one per coarse bar — the period ratio — with events, trades, and summary byte-identical (locked by a differential test against a per-observation-memo oracle).
- Memoized `IndicatorComputeResult`s are shared across observations, so consumers must keep treating results as immutable — the same obligation ADR-0021's intra-batch sharing already imposed; the pager only projects.
- A store mutated mid-replay (a concurrent backfill rewriting candles inside the run window) can serve a pre-mutation cached compute where the old path would have re-read.
  The old path was already nondeterministic under mid-run mutation; the immutability invariant is now documented at the seam instead of implicit.
- Bar-series (OHLCV) paging and the per-drain `latestN` page probes are untouched — they are storage costs owned by Phase 1 (#549); Phase 2 removes compute count only, keeping the two phases independent as designed.
- Reference: #556 (this decision), #548 / #552 / ADR-0021 (the seam), #550 / #553 (the rejected per-consumer memo and its guard), `docs/designs/streaming-backtest-feed.md` §7 / §9.
