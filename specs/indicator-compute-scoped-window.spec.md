# Spec: indicator-compute scoped load window

- Status: draft
- Touches: `@lametrader/core` (`IndicatorModule.warmup`), `@lametrader/engine` (`defineIndicator`, `IndicatorComputeService.compute`, `sma` / `vwma` `warmup`), `@lametrader/web` (`useComputeIndicator` + `computeIndicatorQueryOptions` accept `from` / `to`, chart page passes the candle feed's bounds).

## Goal

The indicator-compute use-case currently loads **the symbol+period's full stored history** for every request (`candles.range(symbolId, period, 0, MAX_SAFE_INTEGER)`) and runs the indicator's pure compute over it.
For long-backfilled symbols + multiple attached overlays on the chart, this spikes the API CPU — the symptom this change addresses.

Scope the load to the chart's visible window plus a per-indicator warm-up margin, by:

- Declaring each indicator's warm-up bar count on its `IndicatorModule` (so the engine knows how much prior history is needed).
- Loading `[max(0, from - warmup*periodMillis), to)` instead of `[0, to)`.
- Passing `from` / `to` from the chart page (derived from the candle feed it already paginates).

The existing guarantee is preserved: the first row in the returned slice is already past warm-up (the load window includes the warm-up margin); when the symbol's stored history is shorter than warm-up, the returned series is all-`null` (silent — same as today).

## Domain / application model

`IndicatorModule` gains an **optional** `warmup?: (inputs) => number` — a pure function returning the count of bars the indicator needs before its first non-`null` row.
It lives on the module (not the serializable `IndicatorDefinition`) because it's a function — same place `compute` and `summary` already live.
The chart / panel don't read it; only the compute service does.

When omitted (or returning `0`), the load window equals `[from, to)` exactly — no extra margin, matching the old behavior for indicators that don't declare warm-up.

## Acceptance criteria

Each bullet maps to exactly one test.

### `@lametrader/engine` — `defineIndicator`

- [ ] `defineIndicator(spec)` forwards `spec.warmup` onto the returned module's `warmup` property verbatim (full-payload `toEqual` on the module shape: `{ definition, compute, summary, warmup }`).

### Reference indicators

- [ ] The `sma` module's `warmup({ length: 14 })` returns `14`.
- [ ] The `vwma` module's `warmup({ length: 20 })` returns `20`.

### `IndicatorComputeService.compute` load window

Tests use a `RecordingCandleRepository` that captures every `range(id, period, from, to)` invocation, wrapping the existing `InMemoryCandleRepository` so the compute still runs against real candles.

- [ ] Called with `{ from: 1_000_000, to: 2_000_000 }` on a module with `warmup({length:14})=14` and period `1h`, loads exactly `[ 1_000_000 - 14*3_600_000, 2_000_000 )` from the candle repo (full-payload `toEqual` on the recorded `range` call args).
- [ ] Called without `{from,to}` loads `[ 0, Number.MAX_SAFE_INTEGER )` from the candle repo — preserving today's full-history behavior for callers that don't scope.
- [ ] Called on a module **without** a `warmup` function, with `{from, to}`, loads exactly `[from, to)` (no margin).
- [ ] Called with `{ from: 0, to: 1_000_000 }` clamps the negative margin: loads exactly `[0, 1_000_000)`.

### `useComputeIndicator` (web)

- [ ] Called with `{ id, key, period, inputs, from, to }` issues `GET /symbols/:id/indicators/:key?period=&from=&to=&<inputs>` (full-payload `toEqual` on the captured URL).
- [ ] Called without `from` / `to` issues the URL without those params (full-payload `toEqual` — the existing test continues to pass).

### Chart-page wiring

- [ ] When the candle feed has N≥1 candles, each per-instance compute call carries `from = candles[0].time` and `to = candles.at(-1).time + 1` (full-payload `toEqual` on the captured compute URLs).
- [ ] When the candle feed is still empty (profile + catalog have resolved but candles haven't), no compute call fires — closes the race where the engine would otherwise see `from`/`to` undefined and fall back to a full-history scan.

## End-to-end expectation

The engine's existing service test for "first row past warm-up is already warm" already covers the cross-cutting expectation (warm-up margin is honored, then the result is sliced to `[from, to)`).
We add **one new e2e** in `packages/api/tests/e2e/`: a request with `?from=&to=` returns rows only inside `[from, to)`, and on a symbol whose stored window straddles `from` the first returned row is already warm (not `null`).

Critical failure mode: a stored history that doesn't reach back the warm-up margin — the returned series's leading rows are `null` (the existing silent-warm-up contract).

## Out of scope

- Server-side caching of compute results across requests — separate, larger concern; can land in a follow-up if the load-window fix isn't enough.
- TanStack Query `staleTime` bumps on the client — orthogonal; this fix already takes the per-request cost down enough that refetch storms hurt less. Can revisit if needed.
- Live indicator updates — already deferred to the live-overlay task.
- Reactive viewport-based refetching as the user scrolls — the chart pages the candle feed; the indicator follows the loaded candle window, not pixel-level scroll.

## Surprises

(filled in retroactively)
