# Spec: streaming backtest feed — Phase 0 (streamFeed + deriveMaxLookback)

- Status: implemented
- Touches: `analytics/backtesting` (new pure feed-streaming + lookback-sizing foundations; no replay wiring)

## Goal

Land the two pure foundations of the streaming backtest feed (design: `docs/designs/streaming-backtest-feed.md`, §1 + §2, targeting #549) so the merge ordering and the lookback sizing are proven in isolation before Phase 1 wires the bounded window.
`streamFeed` reproduces `orderBacktestFeed`'s exact completion-time order without materializing the window; `deriveMaxLookback` sizes the per-period resident window from the profile before a run, or declares the profile non-streamable.
No runtime path changes: nothing is wired into `replay`.

## Acceptance criteria

Each bullet maps to exactly one test.

`streamFeed` (design §1 — `stream-feed.ts`):

- [ ] `completionKey` returns `[candle.time + periodMillis(period), periodMillis(period)]` — the completion-time sort key with the finest-period tie-break component.
- [ ] `lessThan` compares keys lexicographically: earlier completion first, finer period first on completion ties, `false` for equal keys.
- [ ] `streamFeed` collected into an array equals `orderBacktestFeed` over the same per-period `[start, end)` ranges for a multi-period fixture (candles outside the window excluded by both).
- [ ] `streamFeed` breaks completion-time ties finest-period-first — a coarse bar never leaks before the finer bars completing at the same instant (explicit expected order).
- [ ] `streamFeed` over an empty window yields nothing.
- [ ] `streamFeed` with a read-ahead chunk smaller than a period's bar count refills across chunk boundaries and still equals `orderBacktestFeed` (no loss, no reorder).
- [ ] `streamFeed` equals `orderBacktestFeed` on a seeded pseudo-random multi-period fixture (the §8 property/equivalence test).

`deriveMaxLookback` (design §2 — `derive-max-lookback.ts`):

- [ ] `roundToPage` rounds a raw bar count up to a whole `BAR_SERIES_PAGE_SIZE` (64) multiple plus one page of safety margin.
- [ ] `operatorWalkDepth` maps each leaf family to its config-derivable backward-walk depth: `Moving` → `lookbackBars + 1`, `Comparison` → `1`, `State` → `1`, and `Crossing` / `Channel` → `undefined` (unbounded, data-dependent baseline walk).
- [ ] A warmup-only profile (indicator instances, no rules) sizes every active period at `roundToPage(max warmup)` — an instance carries no period, so its warmup applies to each active period.
- [ ] A Moving-lookback-only profile (one `Moving` leaf pinned to an `interval`, no indicators) sizes exactly that period at `roundToPage(lookbackBars + 1)`.
- [ ] Per period, the max leaf walk depth and the max indicator warmup compound (`maxDepth + maxWarmup`) before rounding — an indicator operand pays both the walk and the warmup behind it.
- [ ] The design's compounding example holds: SMA-200 under a `Moving(lookbackBars: 3)` leaf on 1h needs `3 + 1 + 200 = 204` bars, rounded to `256 + 64 = 320`.
- [ ] A leaf without an `interval` is resolved against the firing period, so its depth bumps every active period.
- [ ] A profile whose rules contain a `Crossing` leaf is not streamable: `deriveMaxLookback` returns `undefined`.
- [ ] A profile whose rules contain a `Channel` leaf is not streamable: `deriveMaxLookback` returns `undefined`.

## End-to-end expectation

None this phase — deliberate gap.
Phase 0 adds no runtime path (nothing is wired into `replay`), so there is no end-user-visible surface to drive; the end-to-end proof is Phase 1's differential test (streamed vs. eager replay, byte-identical `BacktestReplayResult`).

## Out of scope

- `WindowedCandleRepository`, `WindowFeeder`, `LookbackUnderflowError`, the run-local `IndicatorService`, `WatchedSymbolCache`, and any `replay` wiring — all Phase 1.
- The streamable/eager routing decision inside `replay` (Phase 1 consumes `deriveMaxLookback === undefined`).
- Any declared `maxLookbackBars` bound for `Crossing` / `Channel` — an open product decision (design §10); those leaves are simply non-streamable here.
- Enabled/disabled filtering of rules or profiles — the caller passes the rules it wants sized (as `replay` already filters by `profileId`).
- Phase 2 coarse-bar change-detection.

## Surprises

- The design sketch's `deriveMaxLookback(profile, rules, registry)` signature references `activePeriods` as a free variable; the real function takes the active periods explicitly (`replay` already holds them as `periods`).
- The design sketch's single `bump` map would compute `max(depth, warmup)`, but the design prose and its worked example (`3 + 1 + 200 = 204`) sum the two maxima per period — the implementation follows the prose (two accumulators, summed before rounding).
- The sketch's `leaf.interval ?? rule.trigger` fallback is not typeable (`trigger` is not a `Period`) and would under-size: an interval-agnostic operand (`Price`) falls back to *any* observed period's series (`evaluation-context.ts` `priceSeries`), so an interval-less leaf bumps **every** active period — over-sizing is safe, under-sizing throws in Phase 1.
