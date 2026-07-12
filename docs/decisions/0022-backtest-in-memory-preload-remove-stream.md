# Backtest replay preloads a bounded candle window into memory; the run stream is removed

- Status: accepted

## Context

`BacktestReplayService.replay` drives the run through the same `wireRuleEngine` the live path uses, and that wiring pages the candle store on demand: for each replayed candle, every trigger event rebuilds its bar-series and indicator-series views, and each view calls `CandleRepository.latestN` / `range` for its lookback.
`ReplayCandleCache` (a short-lived read-through forward-window cache) collapses a bar's same-`before` fan-out and the bar-after-bar re-fetch into one round trip per forward window, but every miss still round-trips the shared store.
The feed itself is already fully materialized in memory by `loadFeed` (`candles.range(start, end)` per active period), so the on-the-fly cost during replay is the lookback reads, not the feed.

Separately, a run is streamed to the browser: the service accumulates a per-run delta/snapshot state and flushes `BacktestFrame`s over `WS /backtests/:id/stream`, and the client folds them into a live-filling chart.
This transport, its flush cadence, its exactly-once snapshot/delta split, and the client-side folding are a large surface whose only purpose is to animate the chart while the run is in flight.

We want the replay to do zero per-candle candle-store round-trips, and we want the UI to simply show the finished result — no live chart, no stream.

## Decision

**1. Preload a bounded candle window into an in-memory repository, and run the whole replay against it.**
Before the replay, derive a per-period lookback depth from the profile's rules and indicator instances, and preload `[start − maxLookback(period) × periodMillis(period), end)` per active period into an in-memory `CandleRepository`.
The engine, the indicator series store, and a run-local indicator service all read that one in-memory repo, so a drain issues no candle round-trips.
The single watched symbol is likewise wrapped in an in-memory watchlist so the replay is literally zero-store once it starts.

**2. The preload is a performance layer, not a correctness authority — reads below the preloaded floor fall through to the shared store.**
`Crossing` / `Channel` operators walk backward past flats to a data-dependent, statically-unbounded depth, so no analyzer can size the window exactly.
The in-memory repo therefore delegates any read it cannot fully satisfy from its resident window to the real candle store (the same read-through `ReplayCandleCache` did on a miss) and logs the breach.
Correctness is guaranteed regardless of the analyzer's accuracy; the analyzer only decides how often the fallback fires.

**3. Size the window by over-approximation.**
`bars(period) = maxIndicatorWarmup + maxMovingLookbackBars + MARGIN`, a single per-period figure applied to every active period (no per-operand period attribution), where `maxIndicatorWarmup` is the max `warmup(inputs)` over the profile's instances, `maxMovingLookbackBars` the max `lookbackBars + 1` over its `Moving` leaves, and `MARGIN` a fixed 64-bar (one page) cushion.

**4. Remove the run stream entirely; the UI polls for progress and renders on completion.**
Delete the `WS /backtests/:id/stream` gateway, the `BACKTEST_STREAM` hub, the `BacktestFrame` protocol, the per-run delta/snapshot accumulator, and the client-side folding.
The run stays an async job (202, one-at-a-time, cancellable, auto-persist on completion); the client polls `GET /backtests/:id` for `progress` until `Completed`, then renders the result through the existing loaded-backtest path.
During a run the UI shows only a progress bar.

## Considered Options

**Preload-all + read-through fallback (chosen).**
The whole `[floor, end)` window is resident for the run; below-floor reads fall through to the shared store.
Simple, correct by construction, and it removes per-drain I/O.
Peak memory is unchanged from today — `loadFeed` already materializes the full `[start, end)` feed — so a large run's memory is handled operationally by raising Node's heap ceiling, not in code.

**Sliding lookback window with a hard underflow error (rejected).**
A `WindowedCandleRepository` holding only `[current − maxLookback, current]` per period, evicting as the run advances, throwing on any read below the floor and routing `Crossing` / `Channel` profiles to an eager path.
This bounds memory independent of span, but it makes correctness depend on an exhaustive, always-in-sync lookback analyzer (a missed source is a hard failure or a wrong verdict), and it cannot make crossover profiles feasible at all without a new user-declared bound.
We chose correctness-by-fallback over span-independent memory: memory is a knob (heap size); a silently-wrong backtest is not acceptable.

**Exact per-operand analyzer (rejected).**
Attribute each operand's lookback to its resolved period precisely.
Impossible in general (`Crossing` / `Channel` are data-dependent) and fragile for the rest; the fallback makes the precision pointless.

## Consequences

- A replay does zero per-candle candle-store round-trips in the common case; the fallback fires only when a walk exceeds the cushion, and each firing is logged so a chronically-too-shallow cushion is visible.
- Peak memory tracks the run window, as it does today; very large runs are accommodated by the documented Node heap setting (`--max-old-space-size`), with no in-code guard.
- `ReplayCandleCache` is replaced by the preloaded repo; the streaming stack (gateway, hub, frame types, accumulator, client folding, the two live-chart specs) is deleted.
- The UI loses the live-filling chart during a run; it shows a progress bar and renders the full result on completion via the existing saved-backtest path.
- Supersedes `docs/designs/streaming-backtest-feed.md`.
  ADR-0021 stays valid — the shared compute memo still dedups within an observation; the preloaded repo just makes each compute in-memory.
