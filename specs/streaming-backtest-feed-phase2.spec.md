# Spec: streaming backtest feed — Phase 2 (coarse-bar change-detection via a run-scoped compute memo)

- Status: implemented
- Touches: `analytics/rules` (compute-memo seam: `indicator-compute-cache.ts`, `wire/wire-rule-engine.ts`), `analytics/backtesting` (`backtest-replay.service.ts` wiring only)

## Goal

Skip redundant coarse-operand computes across fine bars in a backtest replay (design: `docs/designs/streaming-backtest-feed.md` §7 / §9, issue #556) by extending the shared ADR-0021 compute-memo seam from per-observation to run scope, per ADR-0022.
The change-detection predicate is the seam's existing `IndicatorComputeKey`: the compute window is derived from the operand's newest *visible* candle page, so a coarse operand's key is bit-stable across every fine observation within a coarse span and changes exactly when a new coarse bar becomes visible — identical key ⇒ memo hit ⇒ no recompute.
Drains, routing, gates, latches, cascades, and executor stepping are untouched; only pure computes behind identical identities are deduplicated, so results stay byte-identical.

## Acceptance criteria

Each bullet maps to exactly one test.

`createRunScopedIndicatorComputeCache` (`indicator-compute-cache.ts`):

- [ ] A repeated identity runs the loader once and returns the memoized result to both callers (same key semantics as the per-observation cache, now across calls with no batch boundary).
- [ ] A different identity runs the loader again — distinct windows are never conflated.
- [ ] Entries beyond `maxEntries` evict oldest-first: after the cap is exceeded, the oldest untouched identity reloads while the newest still hits.
- [ ] A hit refreshes recency: an entry re-read just before the cap is exceeded survives eviction while the untouched older entry is evicted.
- [ ] A rejected compute is evicted on settlement: the same identity retried after a loader failure runs the loader again instead of replaying the cached rejection for the rest of the run.

`wireRuleEngine` `runComputeCache` option (`wire/wire-rule-engine.ts`):

- [ ] With `runComputeCache` supplied, two replayed candles whose shared operand resolves over an identical visible window drive exactly one `IndicatorService.compute` across both drains (the memo outlives the observation).
- [ ] Without it, the same two candles drive one compute each (the ADR-0021 per-observation lifetime is unchanged — the default stays the live-path behaviour).

`BacktestReplayService` wiring (`backtest-replay.service.ts`):

- [ ] A replayed fixture with a per-tick rule reading a coarse-period (1h) indicator operand over a fine (1m) feed drives exactly one compute per coarse-bar visibility span, not one per fine observation — the compute count drops by the fixture's period ratio (full-payload assertion on the recorded compute calls).
- [ ] Full-replay results (`events`, `trades`, `openPosition`, `summary`, `cancelled`) are `toEqual`-identical to a per-observation-memo oracle (the pre-Phase-2 engine wiring driven over the same ordered feed) on a fixture that fires rules and produces trades — the differential proof that run scoping is a pure work-elimination.
- [ ] The #553 guard stays green: `backtest-replay.service.ts` still carries no `Proxy`, `memoizeCompute`, `'compute'` method-name interception, or `JSON.stringify` key (existing test, unchanged).

## End-to-end expectation

The differential criterion above **is** the end-to-end proof for this phase: a full `replay()` over in-memory stores (feed → engine → events → executor → summary) compared byte-for-byte against the pre-Phase-2 path.
No HTTP/WS surface changes, so no `test/*.e2e-spec.ts` suite is added — same reasoning as ADR-0021's backtest-perspective integration tests (#553).

## Out of scope

- Skipping whole drains or per-rule evaluations — rejected in ADR-0022 (timestamp-dependent semantics; worthless on cross-period rules).
- Wiring `runComputeCache` into the live path (`connect.ts`) — unsound there (forming-bar and backfill upserts break key-implies-inputs; ADR-0022).
- Phase 1 (windowed repo / `WindowFeeder` / run-local `IndicatorService`, #549) — independent storage work.
- Bar-series (OHLCV) paging cost — storage, owned by Phase 1.
- Any `Crossing` / `Channel` lookback bound — open product decision (design §10).

## Surprises

- The existing #553 regression test "recomputes the shared operand on the next replayed candle because the memo is per observation" stays green under run scoping — the two bars' windows differ (`to: 180_001` vs `to: 240_001`), so the keys differ and both computes still happen.
  Its title/comment now credits the advancing window rather than the memo lifetime; assertions unchanged.
