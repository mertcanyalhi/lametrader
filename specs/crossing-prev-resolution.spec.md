# Spec: crossing-evaluator prev resolution under live ticks

- Status: draft
- Touches: `packages/engine/src/rules/condition-evaluator.ts`

## Goal

Make `Current crossing X` decisions reflect the per-event prev/current pair the bridge actually emitted, and surface enough per-leaf trace to diagnose `false` outcomes when they happen.
Closes #381.

Originally three latent issues combined to misfire `Current crossing 0.02622` on a tick that visibly transits the literal:

1. `wireRuleEngine.enqueue` ran `lookups.record(event)` synchronously while scheduling `process(event)` onto the per-symbol chain — under a tick burst the cache rotated N times before any `process(E_i)` evaluated.
2. `getPrevCurrentValue` fell back to `prevCloseValues`, mixing the close axis (polled bars) with the quote axis (live ticks).
3. The leaf-decision trace was silent on prev resolution, so a `false` outcome couldn't be distinguished from "prev was null".

(1) and (2) are now structurally addressed by the orchestrator refactor on `main` (#357 / #362 / #369):
`EvaluationContext.resolvePrevCurrent(operand)` returns `(prev, current)` straight from the inbound event payload when the operand's axis / instance / state key matches the event — bypassing the live cache for any operand that has just transitioned.
A `Current crossing X` rule driven by `CurrentValueChanged` events therefore reads `prev`/`current` from the bridge's `PrevCurrentCache` (quote-axis only), so neither the cache-rotation race nor the cross-axis fallback can reach the decision.

What's left for this fix:

- (3) Add `leftPrev`/`rightPrev` to the existing `leaf_decision` trace so the diagnostic loop closes.
- Regression-prevention e2e through the real `wireRuleEngine` covering both the happy path and the close-axis-bleed scenario — proves that `resolvePrevCurrent` actually shields `Current crossing X` from the close-fallback on the first live tick.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] `condition-evaluator`'s `leaf_decision` TRACE emits `leftPrev` and `rightPrev` alongside `leftValue` / `rightValue` whenever a leaf is evaluated under a `ruleId`.
- [ ] An end-to-end run through `wireRuleEngine` of a `Current crossing 0.02622` rule, fed three same-symbol `SymbolQuoteEvent`s in a burst whose third tick lands at `0.02623` (with priors below the threshold), fires the rule exactly once on the third tick.
- [ ] An end-to-end run through `wireRuleEngine` of a `Current crossing 0.02622` rule, with polled closes above the threshold pre-priming the close cache, then quote ticks at `0.0262` then `0.02623`, does NOT fire on the first quote and fires once on the second.

## End-to-end expectation

A new `packages/engine/tests/e2e/current-crossing-burst.e2e.test.ts` wires `wireRuleEngine` against in-memory adapters with a `Current crossing 0.02622` rule (action: `NotifyTelegram`), pushes three quote events through `QuoteRuleEventBridge.handleQuote` in a synchronous burst (`0.02620 → 0.02621 → 0.02623`), awaits `drain()`, and asserts the symbol log carries exactly one `Fired` entry whose `context.inboundEvent.ts` is the third tick.

The critical failure mode covered: prior `CloseValueChanged` events pre-populating the close cache above the threshold must NOT make the rule fire on the very first quote — the close-axis prev must not leak into the quote-axis crossing decision.

## Out of scope

- Changes to `getCurrentValue`'s close fallback (rules that compare `Current` to a value still need it under close-only polling).
- A snapshot-per-event lookup envelope — `resolvePrevCurrent`'s event-payload-first read already eliminates the per-symbol race for OHLCV / state / indicator operands.
- Changes to indicator / state crossing paths beyond what the trace addition touches.
- Replacing the existing TRACE-level logging machinery; the `leaf_decision` emit already lives in `condition-evaluator.ts` via #354.
- The chart live-event marker work (#375 — separate concern).

## Surprises
