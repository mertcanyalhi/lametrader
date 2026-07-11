# Backtest replay preloads run history into an in-memory candle store

- Status: accepted

## Context

`BacktestReplayService.replay` has two independent storage costs against the shared Mongo-backed candle store.
`loadFeed` eagerly materializes every candle in `[start, end)` across the active periods into one `FeedCandle[]`, and every drain's lookback reads (the bar-series pagers and `IndicatorService.compute` warmup) page that same shared store live.
PR #560 wrapped the per-drain reads in `ReplayCandleCache`, a short-lived rolling-forward-window read-through cache, which collapses a drain's redundant reads but still pages Mongo, and still contends with the live poll loop writing the same collection (~10 ms per round-trip under contention).

The design proposal `docs/designs/streaming-backtest-feed.md` addressed both costs with a bounded sliding-lookback-window feeder that keeps memory span-independent (~100 KB regardless of run length).
It explicitly rejected "preload the whole window into memory" as *strictly dominated*, on the grounds that a 10-year 1-minute run is ~5.26M candles ≈ ~1 GB resident and grows with the span.

That rejection is sound only at that scale.
The backtests this platform actually runs are bounded — on the order of a year or two, at coarse periods (1h / 1d) — where the whole run's candle set is tens of thousands of rows, single-digit MB.
At that scale the sliding window's span-independence buys nothing, while its machinery (a per-period k-way-merge cursor, a `deriveMaxLookback` bound, a windowed repository with an eviction floor, and a bounded-vs-unbounded routing split for `Crossing` / `Channel`) is real, permanent complexity.
The simplest correct design wins: load the run's candles into memory once and serve every read from there.

The binding constraint is **parity**, not performance: a backtest exists to test how the *live* rules would have behaved in the past, so its rule- and indicator-evaluation semantics must be byte-identical to the live engine's.
The evaluation core (the leaf operators, `EvaluationContext` / `resolveSeries` resampling, the once-per-bar latch, the bar→`BarOpened`/`BarClosed`/`Tick` fan-out and its emission order, indicator warmup) *is* the definition of a signal; reimplementing any of it forfeits parity.
Only the candle-reading layer differs between live and backtest, and it is already abstracted behind the `SeriesView` port and the injected `CandleRepository`, so the source can be swapped without touching a line of evaluation code.

## Decision

Rewrite `BacktestReplayService`'s loader and replay loop to run entirely from memory, over the **unchanged shared rule engine** (`wireRuleEngine`, the operators, the indicator service).

- **Preload the full stored history up to `end`, per active period**, into an `InMemoryCandleRepository`, then wire the engine over that in-memory store instead of the Mongo-backed one.
  Loading everything below `end` (not just `[start, end)`) makes every pre-`start` lookback and indicator warmup — including the data-dependent, config-unbounded `Crossing` / `Channel` baseline walk — resolve to exactly what the live path would read, so results are byte-identical by construction rather than by a sized warmup window that could silently under-read.
  Every replay read is bounded above by `event.ts < end`, so the in-memory store is a faithful superset of anything a drain can ask for.
- **Guard the load.** Before preloading, sum the candle count across the active periods; if it exceeds a fixed named cap (~1M candles — generous for any legitimate coarse run, well under memory pressure), throw a `BacktestError` (→ 400) telling the caller to narrow the range or period, rather than OOM the single in-process run and take the server down with it.
  A fixed constant now; lift to `@nestjs/config` only on a second need.
- **Delete `ReplayCandleCache`.** Its sole purpose was collapsing redundant reads against the shared store during replay; once every read hits the in-memory store it is dead weight.
- **Parity stays structural, not tested-for.** The rewrite touches only the loop and the data source; the shared evaluation engine is the same code the live path runs, so backtest and live cannot drift.

This is an internal refactor: results are byte-identical, so it carries no behaviour-spec change.
It reinforces ADR-0021 (the backtest keeps consuming the shared engine's per-observation compute memo, adding no backtest-local memo) rather than amending it.

## Considered Options

**Preload the full run history into an in-memory store (chosen).**
Smallest correct design at the platform's real, bounded scale; parity is structural; the only new logic is the loader and a fail-fast cap.

**Bounded sliding-lookback-window streaming (`docs/designs/streaming-backtest-feed.md`, deferred).**
Correct and span-independent, and the right answer *if* run scale ever becomes unbounded (multi-year at 1-minute granularity).
Rejected for now as permanent complexity that pays for a scale we do not run at.
The proposal is retained and marked superseded-for-now, pointing at this ADR, so the analysis survives for the day scale forces a revisit.

**Reimplement the evaluation core as a standalone backtest engine (rejected).**
Maximum code ownership, but it re-derives the signal semantics the backtest exists to test, so parity becomes best-effort — provable only by differential tests that can never cover every strategy × data edge (the `Crossing` baseline walk, float accumulation order, fan-out tie-breaks).
A backtester that does not match live is worse than a slow one.

**Status quo — on-the-fly reads with `ReplayCandleCache` (rejected).**
The current path; leaves the per-drain Mongo I/O and its live-poll contention in place, which is the cost this change removes.

## Consequences

- The per-drain Mongo I/O and its contention with the live poll loop are gone; every drain reads memory.
- Resident memory is bounded by the symbol's total stored history up to `end` (not the run span), and hard-capped with a clear 400 — a mis-entered fine-grained run fails fast instead of OOM-ing the backend process.
- Backtest results remain byte-identical to today and to the live engine; the existing full-payload unit / e2e / contract suites are the parity net, plus targeted tests for the new preload-extent and guardrail logic.
- The streaming output (per-step deltas, snapshots, progress) and the single-active-run job model are untouched.
- The independent CPU wall — the drain *count* on a very long fine-grained run — is unaffected and out of scope; it never binds at the coarse, bounded scale this platform runs.
- The design stays single-symbol, matching `replay` today.
