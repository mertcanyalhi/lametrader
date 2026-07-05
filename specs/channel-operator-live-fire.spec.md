# Spec: Channel operator fires on real bar history

- Status: implemented
- Touches: `server` — `evaluateChannel`, the live evaluation context's bar series (`warmLiveBarSeries` in `wireRuleEngine`, `prewarmBarSeries`).

## Goal

Prove and guard that an `EnteringChannel` / `ExitingChannel` rule actually fires in the live engine (#500).

`EnteringChannel` / `ExitingChannel` are history-dependent: the operator reads the newest bar, then walks its native timeline backward for the first off-boundary baseline, and only fires when the newest sits inside (Entering) / outside (Exiting) the band while that baseline sat the other way.
Before #504 / #505 the live evaluation context handed operators a single-point bar mirror, so the backward walk past the newest bar was already exhausted, the baseline was never found, and `evaluateChannel` short-circuited to `false` — `Entering` / `Exiting` could never fire (#500), while `InsideChannel` (a pure snapshot test needing only the newest point) still worked.

Those siblings replaced the single-point mirror with a real multi-bar series lazily paged from the candle repository, bounded to `[0, firing-event.ts]`.
This spec locks the end-to-end behaviour the fix enables: with a real backward history, `EnteringChannel` fires.

## Acceptance criteria

Each bullet maps to exactly one test.

### `evaluateChannel` — unit (already covered by `channel.spec.ts`, unchanged)

- [ ] `EnteringChannel` returns `true` when the newest left is strictly inside the band and the first off-boundary baseline going back was strictly outside (with on-boundary consolidation between them skipped).
- [ ] `ExitingChannel` returns `true` when the newest left is strictly outside and the first off-boundary baseline going back was strictly inside.
- [ ] `InsideChannel` is the strict snapshot `lower < latest < upper`, with no historical walk.
- [ ] `EnteringChannel` returns `false` for an empty left series or when no off-boundary baseline exists.

## End-to-end expectation

**Happy path** — an `EnteringChannel` rule on `Close` against constant literal bounds `[90, 110]`, scoped to the watched symbol.
Seed a run of 1m candles whose closes sit strictly above the upper bound (outside the channel), boot the dormant engine, then feed one more live candle whose close lands strictly inside the band.
After the chain drains the rule has fired: a `Fired` rule-event on the symbol followed by its action's `StateSet`.
The newest bar alone cannot decide `Entering` — the fire proves the operator walked back to the seeded outside baseline the live series now exposes.

**Critical failure mode** — the same rule, but the live candle keeps the close strictly outside the band (no entry): the rule does **not** fire.

## Out of scope

- Any change to `evaluateChannel` or the wiring — the multi-bar live series (#504 / #505) already fixes the root cause; this spec adds the end-to-end proof and the guarding e2e.
- Sizing the backward window from the firing rule's channel lookback (the `[0, event.ts]` bound stands; the `lookbackBars × interval` upper path is deferred, per `wire-rule-engine.ts`).
- Dynamic (indicator-envelope) bounds — the e2e uses constant literal bounds; cross-frequency bounds are covered by the operator unit tier.
