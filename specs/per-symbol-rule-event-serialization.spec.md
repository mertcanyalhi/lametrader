# Spec: per-symbol rule-event serialization

- Status: draft
- Touches: `packages/engine/src/rules/wire-rule-engine.ts`

## Goal

Replace the single global promise chain in `wireRuleEngine` with a per-`symbolId` chain so events for different symbols are processed in parallel.
The current chain serializes every `RuleEvent` across every symbol and every event kind, so under load (3+ active symbols, fast period) rule evaluation falls progressively behind the live candle stream (#307).

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] Events with the same `symbolId` are processed in arrival order (the second event's processing starts only after the first one's promise resolves).
- [ ] Events for two different `symbolId`s start processing concurrently — neither one blocks on the other.
- [ ] Events with `symbolId: null` (Timer, GlobalStateChanged) share a single global chain and serialize relative to each other.
- [ ] `drain()` waits for every per-symbol chain plus the global chain to settle.

## End-to-end expectation

The existing `rule-orchestrator-wiring.e2e.test.ts` continues to pass — per-symbol parallelism doesn't change observable end-state for a single-symbol scenario.

## Out of scope

- Batching `CandleRuleEventBridge`'s 5-events-per-candle emission into one orchestrator call (#307 fix-shape option 3 — bigger refactor, revisit if option 1 doesn't move the needle).
- Per-`(profileId, symbolId)` chain (option 2) — same shape, no profile API needed yet.
- Replacing the in-process queue (option 4).
- Operational logging to measure latency — handled by #306.

## Surprises
