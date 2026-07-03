# Spec: `Once` trigger lifetime claim

- Status: implemented
- Touches: `@lametrader/core` (`RuleRepository.claimOnceFire`), `@lametrader/engine` (`rules/dispatch` — in-memory + Mongo adapters, `TriggerDispatcher`).

## Goal

A `Once`-triggered rule fires **exactly once over its lifetime**, and never again — even when qualifying events for several symbols are processed concurrently (`AllSymbols` scope on separate per-symbol chains, #307) or when a single symbol-less dispatch fans one rule out across every watched symbol.

The lifetime once-ever invariant is owned by an **atomic claim** in the `RuleRepository`, not by a read-then-write auto-disable.
`RuleRepository.claimOnceFire(ruleId)` is a single-document test-and-set: it transitions an enabled rule to `enabled: false` and reports whether *this* caller performed the transition.
The dispatcher claims **before** running a `Once` rule's actions; exactly one caller wins and fires, all others lose the claim and skip silently.

This resolves the conflict with `packages/core/src/rules/trigger.types.ts:38` ("on the first matching tick auto-disable the rule" — once ever, whole rule): the atomic claim is the component that enforces that lifetime invariant.
There is no per-symbol `Fired`-entry gate in the current engine — the v1 `once-trigger-gate` module was removed with the rules-v2 cutover (#421); its per-symbol semantics do not apply.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] `claimOnceFire` returns `true` the first time it is called for an enabled rule, and the rule reads `enabled: false` afterward.
- [ ] `claimOnceFire` returns `false` on the second call for the same rule (the claim is already spent).
- [ ] `claimOnceFire` returns `false` for a rule that is already `enabled: false`.
- [ ] `claimOnceFire` returns `false` for an unknown id.
- [ ] The dispatcher claims via `claimOnceFire` on a `Once` rule's first fire (no `save`-based auto-disable), and the rule reads `enabled: false` afterward.
- [ ] A `Once` rule that already lost/spent its claim does not fire again on the next matching tick.
- [ ] An `AllSymbols`-scoped `Once` rule driven by a single symbol-less dispatch that fans out across multiple watched symbols fires exactly once (the first firing symbol wins the claim; the rest are gate-blocked).

## End-to-end expectation

`wireRuleEngine` on in-memory adapters, an `AllSymbols`-scoped `Once` rule whose condition holds for two watched symbols.
Enqueue a qualifying candle event for symbol A and symbol B *before* `drain()` so the two per-symbol chains run concurrently.
After drain: exactly one `Fired` entry on the rule's event log, exactly one notification sent, and the rule reads `enabled: false`.

Critical failure mode: a second qualifying candle event for a third symbol after drain produces no further fire (the claim is spent).

## Out of scope

- The `#307` per-symbol concurrency itself — it stays untouched; the claim makes the invariant hold *despite* it.
- `OncePerBar` / `OncePerBarOpen` / `OncePerBarClose` / `OncePerInterval` gates — unchanged.
- The orchestrator's `lastFiredAt` stamp — a separate rule-doc write; `Fired` entries live in the standalone event log (not the rule document) in the current engine, so the v1 `#300` embedded-events lost-update does not apply here.

## Surprises

- In the current engine the `Once` "gate" (`gateAllows`) always returns `true`; lifetime enforcement lived entirely in the racy `get`→`save` auto-disable. Replacing that with the pre-fire claim both closes the concurrency race and removes the extra `get` round-trip.
</content>
</invoke>
