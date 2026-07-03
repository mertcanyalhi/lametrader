# Period-aware OHLCV operand resolution

- Status: accepted

## Context

A watched symbol can carry multiple bar periods (`Symbol.periods` is a non-empty list), and the candle poller emits one `CandleEvent` per `(symbol, period)`.
The rules engine's v2 core types were designed period-aware — every `LeafCondition` carries an optional `interval: Period`, bar lifecycle events (`BarOpened` / `BarClosed`) and data-update events carry `period`, and the web form has a per-row interval picker — but the evaluation path never consumed the row interval:

- `LiveEvaluationLookups` keyed its OHLCV mirror by `symbolId` alone; `recordCandle` overwrote the slot on every candle of any period.
- `buildEvaluationContext`'s bar series map was keyed by axis only (`barSeriesKey(axis)`), and OHLCV operand resolution ignored the leaf's `interval`.

So for a symbol watched on both 1m and 1h, whichever period polled last won: a rule scoped to the 1h bar evaluated its `Open` / `High` / `Low` / `Close` / `Volume` operands against whatever period's candle most recently landed in the mirror.
This is finding 2 of the rules-engine audit (#463): a second, independent way users saw rules fire "for the wrong candle" (distinct from the read-ahead race in #459).

The conflation is real specifically for evaluation driven by a period-less event — a tick (`everyTime` / `once` / `oncePerBar`) — while candles of several periods sit in the mirror.
Bar-cadence triggers (`oncePerBarOpen` / `oncePerBarClose`) already read their own bar correctly because #459 records each candle in-step immediately before its lifecycle event is processed.

## Decision

Resolve OHLCV operands against the bar period named by the condition **row's** `interval`, end to end:

- **Lookups keyed per period.** `LiveEvaluationLookups` stores OHLCV per `(symbolId, period)`; `EvaluationLookups` OHLCV getters take `(symbolId, period)`; `bookSeriesFor` returns a series map keyed by `(period, axis)`.
- **Evaluation reads the row interval.** `barSeriesKey(period, axis)` keys the bar series map; `EvaluationContext.resolveLatest` / `resolvePrev` / `resolveSeries` accept the resolving leaf's `interval`, and every operator passes `leaf.interval`.
  A leaf scoped to 1h never resolves from a 1m bar; an OHLCV operand with no interval resolves to `null` rather than borrowing another period's bar.
- **Snapshot stamps the period.** The `Fired` context's `RuleEventLookupSnapshot` gains an optional `period`, captured at the rule's referenced OHLCV interval (the trigger's period for bar-cadence triggers, else the first OHLCV interval in the condition).
  Optional so pre-existing period-less entries still deserialize and render.
- **Validation at the boundary.** `validateRuleCondition` (domain) rejects a leaf that references an OHLCV / `indicatorRef` operand without an `interval`; `RuleService` additionally rejects an interval that isn't among the scoped symbols' watched periods for `symbol` / `symbols` scopes (`allSymbols` exempt, mirroring the tick-eligibility gate).

The interval lives on the condition **row (leaf)**, not the operand or the rule — matching the already-accepted v2 condition shape.
Rule-level would be too coarse (one rule legitimately compares across periods); operand-level doubles the picker surface on every row.

## Considered Options

- **Land it in a future engine (the issue's option A).** Moot: the v2 engine is already live and v1 is deleted; there is no other engine to wait for.
- **Indicator period-keying now.** Deferred.
  `IndicatorInstance` is period-less by design (computed at each of the symbol's watched periods), so `(instanceId, stateKey)` alone cannot disambiguate — but the `IndicatorSeriesStore` has no production `warmup` / `onBar` caller, so `indicatorRef` operands always resolve empty today.
  Keying an unpopulated store by period would be anticipatory abstraction (repo anti-dogma rule); the shared interval-required validation still applies to indicator rows so the schema is correct when the store is wired.

## Consequences

- A rule referencing two OHLCV intervals snapshots only the first one — the single-axis `RuleEventLookupSnapshot` holds one period. A per-period snapshot map is the upgrade path when a multi-interval rule needs every axis captured.
- The `oncePerBar` / `oncePerBarClose` cadence gate was already period-correct (routing filters bar events by trigger period; the dispatcher latch is keyed by period); this change is confined to operand resolution.
