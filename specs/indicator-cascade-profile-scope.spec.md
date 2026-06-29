# Spec: indicator cascade profile scope + polled-only tick gating

- Status: draft
- Touches: `@lametrader/core` (event type), `@lametrader/engine` (indicator-cascade bridge, trigger dispatcher, rule-engine wire)

## Goal

Scope indicator-cascade re-evaluations to the originating profile so a state-key change on a profile-attached indicator instance fans out only to rules in that profile — mirroring `SymbolStateChangedEvent` / `GlobalStateChangedEvent` (#281).
Lock in the "no synthesized ticks" pillar (ADR 0016) with a dedicated negative test so a polled-only symbol that gains `BarOpened` / `BarClosed` events never sees a `TickEvent`.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] `IndicatorChangedEvent` carries a `profileId` string field (core event-type test).
- [ ] `IndicatorCascadeBridge.bindSubscription(subscriptionId, instanceId, profileId)` records the profileId and emits it on each subsequent `IndicatorChanged` event for that subscription.
- [ ] `IndicatorCascadeBridge` keeps independent slot caches per `(symbolId, period, instanceId, stateKey)` regardless of profileId — same instance can be attached to multiple profiles and each profile gets its own emit on the first observation.
- [ ] `TriggerDispatcher.dispatch` for an `IndicatorChanged` event filters candidate rules by `event.profileId` (same-profile fires, different-profile asleep).
- [ ] `wireRuleEngine` plumbs `bindSubscription`'s new `profileId` parameter through.
- [ ] A polled-only symbol (only `BarLifecycleBridge.handleCandle` upstream, no `QuoteStreamService` subscription) receives `BarOpened` / `BarClosed` events but never a `TickEvent` — protects the "no synthesized ticks" pillar.

## End-to-end expectation

The existing `rules-bridges.e2e.test.ts` continues to pass after the `bindSubscription` signature gains `profileId` and the cascade event carries it.
A polled-only symbol asserts a `BarOpened` but no `TickEvent` in `emitted`.

## Out of scope

- Production wiring of `bindSubscription` in `connect.ts` (no production caller exists today; the test e2e exercises the bridge and the orchestrator path through unit-tier coverage).
- Changes to indicator instance lifecycle, attachment, or subscription registration.

## Surprises

_(filled in retroactively)_
