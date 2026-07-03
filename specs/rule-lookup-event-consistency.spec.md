# Spec: Rule lookup/event consistency (no look-ahead across a serialized batch)

- Status: implemented
- Touches: `packages/engine/src/rules/wire/wire-rule-engine.ts` (the wire-up), `LiveEvaluationLookups` (JSDoc timing note).

## Goal

Make the synchronous `LiveEvaluationLookups` mirror advance **inside** the per-symbol serialized processing step, at per-upstream-event batch granularity, so every rule evaluates against the mirror state of the event's **own** observation — never a later batch's.

Today `wireRuleEngine` updates the mirror (`recordCandle` / `recordQuote` + tick-ring push / `recordIndicatorState`) **synchronously at enqueue time**, while orchestrator processing is deferred onto a per-symbol promise chain.
When `PollingService.pollOne` emits a multi-candle batch at a bar rollover (previous bar now final + new forming bar, emitted back-to-back in one synchronous loop), the mirror already holds the **new** bar's OHLCV while the orchestrator is still evaluating the **previous** bar's events.
A rule conditioned on an OHLCV axis therefore reads the future bar's value, the fire is attributed to the previous bar, and an `OncePerBar` rule fires a second time on the new bar — the user-visible "Candle Open rule fires for the previous candle" plus a double-fire at rollover.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] A rule conditioned on an OHLCV axis (`Open`), woken by a **different-axis** lifecycle event of the previous (final) bar in a rollover batch fed without an intervening `drain()`, resolves the operand to the **previous** bar's value — the previous bar's condition outcome, not the new bar's.
- [ ] A rollover batch (previous final bar whose values fail the condition + new forming bar whose values pass, fed with no `drain()` in between) on an `Open > N` / `OncePerBar` rule produces **exactly one** `Fired`, with `ts` in the **new** bar (the bar whose values satisfied the condition) — no double fire, no fire stamped at the previous bar.
- [ ] The persisted `Fired` context `lookupSnapshot` for that single fire contains only the firing (new) bar's OHLCV values — no future-bar or previous-bar leakage.
- [ ] Within one candle's serialized batch, all five OHLCV slots of that candle are visible to the events of that batch (a `Close`-conditioned `OncePerBarClose` rule on a single final candle still fires with the candle's full OHLCV in its snapshot) — the atomic-observation invariant is preserved.
- [ ] The per-symbol serializer records a batch's mirror update only when that batch's serialized step runs: given two batches enqueued back-to-back for one symbol, the second batch's recorded values are not visible while the first batch is being processed.
- [ ] `wired.lookups.warm…`/`warmInitialState` startup seeding is unaffected (the cold-start mirror is non-empty before the first event, unchanged).

## End-to-end expectation

Happy path: drive the real `wireRuleEngine` with a rollover batch — `barBridge.handleCandle(previousFinalBar)` then `barBridge.handleCandle(newFormingBar)` synchronously with **no** `drain()` between them — for an `Open > N` rule triggered `OncePerBar`.
After a single `drain()`, both event logs contain exactly one `Fired` entry, stamped at the new bar's open time, whose `lookupSnapshot.open` is the new bar's open.

Critical failure mode: the previous bar's own values do **not** satisfy the condition, yet without the fix the previous-bar event would fire (mis-attributed) and the new-bar event would fire again — the test asserts neither the mis-attributed fire nor the double fire occurs.

## Out of scope

- No change to bridge public signatures or their unit tests — the defect is a timing bug in the wire, so the fix lives in the wire.
- No change to core event shapes (`BarOpened` / `BarClosed` stay OHLCV-free; the mirror remains the OHLCV source).
- No change to the `IndicatorRef` evaluation path (it reads `IndicatorSeriesStore`, not the lookups mirror; the lookups indicator slot has no production reader).
  The indicator batch's `recordIndicatorState` is still moved in-step for consistency, but it changes no observable `IndicatorRef` behavior in the current engine.
- The secondary `pollOne` `now`-captured-before-fetch observation from the issue is not addressed (explicitly a non-cause).

## Surprises

- The bug is a timing bug in `wireRuleEngine`, not in the bridges — the bridges translate events correctly; the wire recorded the mirror ahead of the serialized queue.
  So the fix lives entirely in `wire-rule-engine.ts` (batch each upstream observation's fan-out and run its `record` inside the serialized step), leaving all bridge signatures and their tests untouched.
- `OncePerBar` in the current engine is **tick-driven** (`routes` maps it to `Tick`; `BarOpened` only re-arms its latch).
  OHLCV rules driven by bar events use `OncePerBarClose` / `OncePerBarOpen`, so the rollover look-ahead + double-fire reproduces cleanly with an `OncePerBarClose` OHLCV rule on a two-final-bar catch-up poll — the issue's v1 `OpenValueChanged`/`OncePerBar` scenario re-mapped onto the current trigger model.
- The issue's indicator sub-finding is **not observable via `IndicatorRef`** in the current engine: `IndicatorRef` resolves through `IndicatorSeriesStore` (not the lookups mirror), the lookups indicator slot (`getIndicatorValue`) has no production reader, and `IndicatorSeriesStore.onBar` is never called in production.
  The indicator batch's `recordIndicatorState` is still advanced in-step for consistency, but it changes no observable `IndicatorRef` behavior today.
- `Period.M1` isn't a member of the core `Period` enum, yet `wire-rule-engine.test.ts` uses it (it evaluates to `undefined` at runtime and stays self-consistent because routing compares `undefined === undefined`).
  The new unit tests follow that file's existing convention; the e2e uses the real `Period.OneMinute` because the polling path needs `periodMillis`.
