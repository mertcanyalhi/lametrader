# Spec: Crossing operator fires on real bar history

- Status: implemented
- Touches: `server` — `evaluateCrossing`, the live evaluation context's bar series (`warmLiveBarSeries` in `wireRuleEngine`, `prewarmBarSeries`).

## Goal

Prove and guard that a `CrossingUp` / `CrossingDown` rule actually fires in the live engine (#501).

Crossing is history-dependent: the operator reads the newest bar's side of the boundary, then walks its native timeline backward for the first non-flat baseline, and only fires when the newest side differs from that baseline side (further gated by the up / down direction).
Before #504 / #505 the live evaluation context handed operators a single-point bar mirror, so the backward walk past the newest bar was already exhausted, the baseline was never found (`baselineSide === 0`), and `evaluateCrossing` short-circuited to `false` — no cross could ever be detected (#501).

Those siblings replaced the single-point mirror with a real multi-bar series lazily paged from the candle repository, bounded to `[0, firing-event.ts]`.
This spec locks the end-to-end behaviour the fix enables: with a real backward history, `CrossingUp` fires when a live bar carries the close from below the boundary to above it.

## Acceptance criteria

Each bullet maps to exactly one test.

### `evaluateCrossing` — unit (already covered by `crossing.spec.ts`, unchanged)

- [ ] `CrossingUp` returns `true` when the newest left strictly exceeds the right and the most recent non-flat baseline going back was strictly below (with on-boundary consolidation between them skipped).
- [ ] `Crossing` skips historical points where `left === right` (lookback-past-flats) and fires on the first non-flat baseline the other side.
- [ ] The verdict is cadence-independent — a rare vs a frequent right series resample to the same result via `asOf`.
- [ ] `CrossingUp` returns `false` for an empty left series, a latest sitting on the boundary, or when no non-flat baseline exists.

## End-to-end expectation

**Happy path** — a `CrossingUp` rule on `Close` against a constant literal boundary `100`, scoped to the watched symbol.
Seed a run of 1m candles whose closes sit strictly below the boundary (left below right), boot the dormant engine, then feed one more live candle whose close lands strictly above the boundary.
After the chain drains the rule has fired: a `Fired` rule-event on the symbol followed by its action's `StateSet`.
The newest bar alone cannot decide a cross — the fire proves the operator walked back to the seeded below baseline the live series now exposes.

**Critical failure mode** — the same rule, but the live candle keeps the close strictly below the boundary (no cross): the rule does **not** fire.

## Out of scope

- Any change to `evaluateCrossing` or the wiring — the multi-bar live series (#504 / #505) already fixes the root cause; this spec adds the end-to-end proof and the guarding e2e.
- Sizing the backward window from the firing rule's lookback (the `[0, event.ts]` bound stands; the `lookbackBars × interval` upper path is deferred, per `wire-rule-engine.ts`).
- Cross-frequency (indicator-right) crossings — the e2e uses a constant literal boundary; cross-frequency resampling is covered by the operator unit tier.
