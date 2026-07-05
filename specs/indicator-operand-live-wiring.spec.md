# Spec: indicator operands fire live (populate the store the evaluator reads)

- Status: implemented
- Touches: `server` — `IndicatorSeriesStore`, `buildEvaluationContext` (IndicatorRef resolution), `RuleEngineService.start` (startup warmup), `wireRuleEngine` (onBar drive from the candle feed).

## Goal

Make rules that reference a profile-attached indicator (`OperandKind.IndicatorRef`) actually fire.
Today `IndicatorSeriesStore` — the store the evaluator reads through — is never populated in production, so every indicator operand resolves to `null` and the rule silently never fires (#498).

An indicator instance is computed for every symbol its profile applies to, across each symbol's watched periods (per the attach spec — no period is stored on the instance).
The `IndicatorRef` operand disambiguates by the firing symbol (ADR 0016) and the leaf's `interval` (per `operand.types.ts`).
So the store must be keyed by the same `(symbolId, period, instanceId, stateKey)` slot the `IndicatorCascadeBridge` already uses, and operand resolution must read that slot with the firing symbol + leaf interval — not by `instanceId` alone (which collapses every symbol/period of one instance onto one series).

## Acceptance criteria

Each bullet maps to exactly one test.

### `IndicatorSeriesStore` — slot keyed by `(symbolId, period, instanceId, stateKey)`

- [ ] `warmup` then `latest(symbolId, period, instanceId, 'value')` returns the SMA computed over that symbol+period's seeded candles.
- [ ] Two symbols warmed under the **same** `instanceId` keep independent series — `latest` reads the requested symbol's value, not the other's (proves the compound key fixes the multi-symbol collapse).
- [ ] `onBar(symbolId, period, candle)` appends a fresh row to every instance registered at that `(symbol, period)` so `latest` reflects the new bar.
- [ ] `latest` / `series` return `null` / an empty view for a slot that was never warmed.

### `buildEvaluationContext` — IndicatorRef reads the firing symbol + leaf interval

- [ ] `resolveLatest` of an `IndicatorRef` at a given interval reads the store slot for the context's firing `symbolId` and that interval.
- [ ] `resolveLatest` of an `IndicatorRef` with no interval resolves to `null` (no period to key on — parity with the OHLCV operands).

### `RuleEngineService.start` — warm the store from profiles

- [ ] `start()` warms the store for each enabled profile's instances across the profile's in-scope symbols × each symbol's watched periods, so a warmed instance's `latest` is non-null before any live candle.
- [ ] An instance whose indicator does not apply to a symbol's asset class is skipped, not fatal (the rest still warm).

## End-to-end expectation

**Happy path** — an `sma` instance attached to a profile, and a `Comparison` rule `IndicatorRef(sma.value) > literal` scoped to the symbol.
Seed candles whose SMA sits below the literal, boot the engine (warmup), then feed one more live candle that lifts the SMA above the literal.
After the chain drains the rule has fired: a `Fired` rule-event on the symbol and the rule, and its action's state write is visible.

**Critical failure mode** — the same rule, but the live candle keeps the SMA below the literal: the rule does **not** fire (no false positive from a stale/among-symbols value).

## Out of scope

- Re-keying or changing the **contract** of `resolveLatest` / `resolveSeries` / `resolvePrev` — the operator-facing signatures are unchanged; only the internal store lookup gains the symbol + period it already had in context.
- Dynamic re-warm when a profile's indicators, a profile's scope, or the watchlist changes after boot — startup warmup + live `onBar` for warmed slots is the deliverable.
- Feeding the store from the `IndicatorService` live subscription stream / `IndicatorCascadeBridge` (that path stays as the `IndicatorChanged` wake-up + `LiveEvaluationLookups` snapshot); this change feeds the evaluator's store directly from the candle feed the engine already consumes.
- Non-numeric indicator state keys (Bool / Enum) — only numeric fields are projected into the series store, unchanged from today.

## Surprises

_(filled in retroactively)_
