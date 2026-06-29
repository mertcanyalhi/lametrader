# Spec: rules dispatch threads the rule's profileId

- Status: implemented
- Touches: `packages/engine/src/rules/dispatch/dispatcher.ts`, `packages/engine/src/rules/wire/wire-rule-engine.ts`, `packages/engine/tests/e2e/rules-orchestrator.e2e.test.ts`.

## Goal

The trigger dispatcher must thread the firing rule's `profileId` into its `buildContext` callback so `SymbolStateRef` / `GlobalStateRef` operand reads happen in the rule's profile namespace.
Currently the production wire-up hardcodes `profileId: ''`, so every state-aware condition resolves to `null` and looks like it never matched.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] `TriggerDispatcher.dispatch` invokes `buildContext` with the rule's `profileId` as the third positional argument, for both the symbol-bearing and the symbol-less event paths.
- [ ] `wireRuleEngine`'s `buildContext` callback passes the received `profileId` (not `''`) to `buildEvaluationContext`, so a tick-driven rule whose condition is `SymbolStateRef == Literal` evaluates true when state was written under the rule's profile.
- [ ] `wireRuleEngine`'s orchestrator-error catch logs (with `ruleId`, symbol, and the error stack) and appends an `Error` rule-event entry to both the rule's and the firing symbol's event log, instead of silently swallowing.

## End-to-end expectation

A new `rules-wire-engine.e2e.test.ts` builds the real `wireRuleEngine` (no harness override), pre-seeds a symbol-state key under `profile-1`, files a rule whose `condition` is `SymbolStateRef('breached') == true`, then drives a tick.
The fix is gated: with the current `profileId: ''` the rule does NOT fire (no Fired entry); after the fix it fires and writes the expected notification entry.

## Out of scope

- Threading `profileId` onto `IndicatorChangedEvent` itself (covered by #424).
- Persisting / replaying the new `Error` entry shape — `RuleEventType.Error` already exists in core; we just emit one.

## Surprises

The `LiveEvaluationLookups` sync mirror subscribes to `state.onStateChanged` inside the `wireRuleEngine` call; any state written BEFORE wiring is invisible to the mirror unless `warmInitialState(snapshot)` is invoked.
The regression e2e seeds state AFTER wiring to mirror what production does (`connectServices` wires the engine before any state-set occurs in the request cycle).
For cold-start replay scenarios, `warmInitialState` exists.
