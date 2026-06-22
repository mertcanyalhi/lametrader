# Spec: candle stream to rule-event bridge

- Status: implemented
- Touches: `engine` (`packages/engine/src/rules/candle-rule-event-bridge.ts`).

## Goal

Bridges `PollingService`'s `CandleEvent`s into per-OHLCV-field `RuleEvent`s the engine evaluator consumes.
For each inbound candle the bridge emits one event per field that actually changed against the per-`(symbol, period, field)` slot in its `PrevCurrentCache`, propagating the inbound `final` flag so triggers like `OncePerBarClose` can gate on the close event.

## Acceptance criteria

- [ ] The first observation of a candle emits one event per OHLCV field with `prev: null` and the field's value as `current`.
- [ ] A re-poll of the same forming bar only emits events for the fields that changed against their previous values.
- [ ] `final: true` on the inbound bar is propagated to every emitted event.
- [ ] An FX candle (no volume) skips the `VolumeValueChanged` event and only emits open/high/low/close events.
- [ ] `prev`/`current` state is isolated between symbols — the first candle for a different symbol emits `prev: null` on every field.
