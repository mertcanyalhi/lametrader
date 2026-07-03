# Spec: period-aware OHLCV operand resolution

- Status: implemented
- Touches: `engine` rules evaluation (`LiveEvaluationLookups`, `evaluation-context`, operators, `action-runner`), `core` (`RuleEventLookupSnapshot`, condition validation), `api` (`rule.schema`), `web` (rule events dialog).

## Goal

Resolve a rule condition row's OHLCV operands (`Open`/`High`/`Low`/`Close`/`Volume`) against the bar period named by the row's `interval`, so a symbol watched on multiple periods (e.g. 1m + 1h) no longer conflates.
Today the engine keys the live OHLCV mirror by `symbolId` alone and never reads the row's `interval`, so the most recent candle of any period wins and a rule scoped to 1h evaluates against whatever period polled last.

The v2 groundwork already exists — every `LeafCondition` carries an optional `interval`, bar events carry `period`, the web form has an interval picker, and the API schema round-trips it — but no evaluation code consumes it.
This spec wires the last mile.

## Acceptance criteria

- [ ] `LiveEvaluationLookups.recordCandle` stores the OHLCV snapshot per `(symbolId, period)`; recording a 1m candle for a symbol leaves the value read for that symbol's 1h period unchanged.
- [ ] `EvaluationLookups` OHLCV getters (`getOpenValue`/`getHighValue`/`getLowValue`/`getCloseValue`/`getVolumeValue`) take `(symbolId, period)` and return that period's value (or `null` when unobserved).
- [ ] `LiveEvaluationLookups.bookSeriesFor(symbolId)` returns a series map keyed by `(period, axis)`, one axis series per observed period, so a per-period operand read resolves independently.
- [ ] `buildEvaluationContext`'s OHLCV operand resolution (`resolveLatest`/`resolvePrev`/`resolveSeries`) uses the caller-supplied leaf `interval` to select the `(period, axis)` series; an operand read with interval 1h never returns a 1m value.
- [ ] Every operator (`comparison`/`crossing`/`channel`/`moving`/`state`) passes its leaf's `interval` when resolving OHLCV operands, so a leaf scoped to 1h resolves each of its OHLCV operands at 1h.
- [ ] The `Fired` context's `RuleEventLookupSnapshot` records the `period` its OHLCV values were captured at (the rule's referenced OHLCV interval); the field is optional so pre-existing period-less entries still deserialize.
- [ ] `validateRuleCondition` (domain) rejects a condition tree containing a leaf that references an `Open`/`High`/`Low`/`Close`/`Volume`/`IndicatorRef` operand without an `interval`.
- [ ] `RuleService.create`/`patch` reject a rule whose condition references an `interval` not in the watched periods of the rule's scoped symbols, for `Symbol`/`Symbols` scopes (`AllSymbols` exempt, matching the tick-eligibility check).
- [ ] The web rule events dialog renders the inbound event's `period` for a `Fired` entry driven by a bar event, and omits it (no crash) for a period-less inbound event or a legacy entry.

## End-to-end expectation

Watch `BTCUSDT` on `[1m, 1h]`. Create a rule `Open > 50000` on a leaf with `interval: 1h`, trigger `OncePerBar(1h)`.
Feed a 1h bar opening at 49900 and repeated 1m bars opening above 50000, then ticks.
The rule does **not** fire (the 1h open, 49900, fails the condition) even though the 1m open crosses 50000 — proving operand resolution reads the row's interval, not the last-polled candle.

Critical failure mode (regression guard): the same setup on the pre-fix engine fires on the 1m open; assert the post-fix engine records no `Fired` entry for the hour.

## Out of scope

- Indicator period-keying beyond the shared interval-required validation: the `IndicatorSeriesStore` has no production `warmup`/`onBar` caller, so `IndicatorRef` operands always resolve empty today.
  Keying an unpopulated store by period would be anticipatory abstraction (repo anti-dogma rule); deferred until the store is production-wired.
- The `OncePerBar` / `OncePerBarClose` cadence gate — already period-correct (`routes` filters bar events by trigger period; the dispatcher latch is keyed by period). Covered by a regression test only.
- Cross-period series-aware operators (a single `Crossing` comparing 1h vs 1d) — a leaf carries one interval covering all its operands.

## Surprises

_(filled in after the feature lands)_
