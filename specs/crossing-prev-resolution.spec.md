# Spec: crossing-evaluator prev resolution under live ticks

- Status: draft
- Touches: `packages/engine/src/rules/wire-rule-engine.ts`, `live-evaluation-lookups.ts`, `rule-orchestrator.ts`

## Goal

Make `Current crossing X` decisions reflect the per-event prev/current pair the bridge actually emitted, and surface enough per-leaf trace to diagnose `false` outcomes when they happen.
Closes #381.

The current chain has two latent prev/current resolution bugs that combine to make `Current crossing 0.02622` evaluate `false` on a tick that visibly moves through the literal:

1. `wireRuleEngine.enqueue` runs `lookups.record(event)` synchronously on every arrival, while `serializer.enqueue(event)` defers `process(event)` onto the per-symbol promise chain.
   Under a burst, the cache rotates N times before any `process(E_i)` runs — by the time the orchestrator evaluates `E_1`, `getCurrentValue`/`getPrevCurrentValue` already reflect `E_N`'s slot state, not `E_1`'s.
2. `getPrevCurrentValue` falls back to `prevCloseValues` when no quote-axis prev exists yet (`live-evaluation-lookups.ts:184`).
   That mixes axes — the current value comes from the quote stream while the prev comes from the polled close — so a `Current crossing X` decision on the first live quote reads against an unrelated time axis.

The trace is silent about prev resolution, so a `result: false` can't be distinguished from "prev was null" without diving into the cache state at a particular moment.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] `wireRuleEngine`'s `enqueue` does not rotate the lookups cache ahead of `orchestrator.process` — for two same-symbol `CurrentValueChanged` events enqueued back-to-back, the orchestrator sees `(prev, current)` matching the *first* event when it processes the first one, not the second event's state.
- [ ] `LiveEvaluationLookups.getPrevCurrentValue` returns `null` when no `CurrentValueChanged` has been recorded for the symbol, even if `CloseValueChanged` events have populated `prevCloseValues`.
- [ ] `LiveEvaluationLookups.getCurrentValue` still falls back to the latest close when no quote has been observed (unchanged from today).
- [ ] `RuleOrchestrator`'s leaf dispatch emits one structured `leaf_decision` TRACE log per evaluated leaf, carrying `ruleId`, `leafIndex`, `operator`, both descriptor / value / source fields per operand, **and** `leftPrev` / `rightPrev`, plus the boolean `result`.
- [ ] An end-to-end run through `wireRuleEngine` of a `Current crossing 0.02622` rule, fed three same-symbol `SymbolQuoteEvent`s in a burst whose third tick lands at `0.02623` (with priors below the threshold), fires the rule exactly once.

## End-to-end expectation

A new `packages/engine/tests/e2e/current-crossing-burst.e2e.test.ts` wires `wireRuleEngine` against in-memory adapters with a `Current crossing 0.02622` rule (action: `SetSymbolState`), pushes three quote events through `QuoteRuleEventBridge.handleQuote` in a synchronous burst (`0.02620 → 0.02621 → 0.02623`), awaits `drain()`, and asserts:

- the rule's event log contains exactly one `Fired` entry, and
- the symbol state was set by the rule's action.

The critical failure mode covered: prior `CloseValueChanged` events pre-populating `prevCloseValues` to a value above the threshold must NOT make the rule fire on the very first quote — the close-axis prev must not leak into the quote-axis crossing decision.

## Out of scope

- Changes to `getCurrentValue`'s close fallback (rules that compare `Current` to a value still need it under close-only polling).
- A snapshot-per-event lookup envelope (the per-symbol serializer move is equivalent for the per-symbol contention case).
- Changes to indicator / state / OHLCV crossing paths beyond what the prev resolution fix touches.
- Replacing the existing TRACE-level logging machinery; `getLogger('condition-evaluator').trace(...)` reuses the engine's Pino root.
- The chart live-event marker work (issue #375 — separate concern).

## Knock-on: per-event context (#304) snapshot semantics

The fix moves `lookups.record(event)` out of `wireRuleEngine.enqueue` and into the per-symbol serializer callback.
Today, the candle bridge synchronously fires 5 OHLCV events into `enqueue`, all 5 `record`s land before any event is processed, and `RuleOrchestrator.captureContext` then sees the full post-burst snapshot regardless of which OHLCV event the rule fired on.
After the fix, each event in the burst processes against the slot state that existed at *its* turn in the serializer chain.
So a rule firing on `CloseValueChanged` will see `volume: null` in `lookupSnapshot` (volume rotates after close), and a rule firing on `OpenValueChanged` will see only `open` populated.
That's a behavior change to #304's modal payload — accepted as the more-correct semantics ("what the rule actually saw when its condition evaluated true").
The `per-event-context-modal.spec.md` is updated to spell this out, and the existing `rule-orchestrator-wiring.e2e.test.ts` expectations on `lookupSnapshot` are revised in lockstep.

## Surprises
