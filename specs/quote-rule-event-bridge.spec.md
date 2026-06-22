# Spec: quote stream to rule-event bridge

- Status: implemented
- Touches: `engine` (`packages/engine/src/rules/quote-rule-event-bridge.ts`).

## Goal

Bridges `QuoteStreamService`'s `SymbolQuoteEvent`s into `CurrentValueChanged` `RuleEvent`s the engine evaluator consumes.
Decorates each inbound quote with `prev` + `current` via a per-bridge `PrevCurrentCache`; `quote.time` becomes the event `ts` per ADR 0012.

## Acceptance criteria

- [ ] The first quote for a symbol emits one `CurrentValueChanged` event with `prev: null` and `current` equal to the inbound price.
- [ ] A subsequent quote for the same symbol emits `prev` equal to the previously seen price alongside the new `current`.
- [ ] `prev`/`current` state is isolated between symbols — the first quote for a different symbol still emits `prev: null`.
