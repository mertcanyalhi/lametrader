# Spec: indicator stream to rule-event bridge

- Status: implemented
- Touches: `engine` (`packages/engine/src/rules/indicator-rule-event-bridge.ts`).

## Goal

Bridges `IndicatorStreamService`'s `IndicatorStateEvent`s into `IndicatorValueChanged` `RuleEvent`s the engine evaluator consumes.
For each inbound state row the bridge emits one event per `stateKey` whose value differs from the previously cached value for the same `(instanceId, stateKey)` slot, wrapping raw values in their `StateValue` variant by JavaScript type (number/bool/enum).

## Acceptance criteria

- [ ] An event for an unbound `subscriptionId` is silently ignored — no events are emitted.
- [ ] The first observation of a bound subscription emits one `IndicatorValueChanged` event per state key with `prev: null` and the wrapped `StateValue` as `current`.
- [ ] A subsequent state row only emits events for state keys whose value changed against the previous observation.
- [ ] An enum (string) state value round-trips through the cache and surfaces as a `StateValueType.Enum` in both `prev` and `current` when it changes.
- [ ] A state key whose raw value is `null` (warm-up) is skipped and emits no event.
- [ ] `unbindSubscription(...)` stops further events being emitted for that subscription.
