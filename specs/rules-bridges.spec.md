# Spec: rules bridges + event sources

- Status: draft
- Touches: `packages/engine/src/rules/bridges/*` (new); consumes existing event types from `@lametrader/core` (`SymbolQuoteEvent`, `StateChangedEvent`, `IndicatorStateEvent`) and `packages/engine/src/candles/polling-service.types.ts` (`CandleEvent`).

## Goal

Translate upstream data-source events into the rules `EvaluationTriggerEvent` channel.
Three bridge families cover the three source channels:

- `TickBridge` — `SymbolQuoteEvent` (live quote stream) → `TickEvent`.
- `BarLifecycleBridge` — `CandleEvent` (polling + backfill) → `BarOpenedEvent` / `BarClosedEvent` with per-`(symbol, period)` dedup.
- `StateCascadeBridge` + `IndicatorCascadeBridge` — `StateChangedEvent` and `IndicatorStateEvent` → `SymbolStateChangedEvent` / `GlobalStateChangedEvent` / `IndicatorChangedEvent` (preserves v1's cascade re-entry semantics).

Per ADR 0016: tick events come exclusively from live quote subscriptions — no synthesized ticks from polled candle closes.

## Acceptance criteria

- [ ] `TickBridge.handleQuote(event)` emits one `TickEvent` on the first observation of a `(symbolId, period)` pair, with `ts = event.quote.time`, `symbolId = event.id`, `price = event.quote.price`.
- [ ] `TickBridge.handleQuote(event)` emits nothing when the inbound `event.quote.price` equals the last price emitted for the same `(symbolId, period)` — changed-only emission, mirroring the indicator/bar bridges' suppression, so unchanged flat-market ticks and duplicate per-subscription quotes drive no orchestrator pass.
- [ ] `TickBridge.handleQuote(event)` emits a `TickEvent` again once the price differs from the last emitted price for that `(symbolId, period)`.
- [ ] `TickBridge` keeps its last-price cache isolated per `(symbolId, period)` — a flat price on one pair does not silence a moving price on another.
- [ ] `TickBridge.handleQuote(event)` ignores the inbound `final` flag (a forming and a closed quote at different prices each produce a `TickEvent`; the emitted `TickEvent` never carries `final`).
- [ ] `BarLifecycleBridge.handleCandle(event)` emits `BarOpenedEvent(symbolId, period, ts = candle.time)` on the first observation of a `(symbolId, period)` pair.
- [ ] `BarLifecycleBridge.handleCandle(event)` emits `BarOpenedEvent` whenever `candle.time` advances past the prior observation for the same `(symbolId, period)`.
- [ ] `BarLifecycleBridge.handleCandle(event)` emits nothing on a re-poll of the same forming bar (`candle.time` unchanged, `final = false`, and the close has not yet fired).
- [ ] `BarLifecycleBridge.handleCandle(event)` emits `BarClosedEvent(symbolId, period, ts = candle.time)` on the first observation with `final = true` for that `(symbolId, period, ts)`; subsequent `final = true` observations on the same `(symbolId, period, ts)` are deduped.
- [ ] `BarLifecycleBridge.handleCandle(event)` emits `BarOpenedEvent` followed by `BarClosedEvent` (in that order) when a single inbound candle both advances `ts` and arrives as `final = true` (e.g., a backfilled closed candle).
- [ ] `BarLifecycleBridge` keeps state isolated per `(symbolId, period)` — emissions for one pair do not silence another pair.
- [ ] `StateCascadeBridge.handleStateChange(event)` emits `SymbolStateChangedEvent` (carrying `profileId`, `symbolId`, `key`, `prev`, `current`, `ts`) when `event.scope.kind === StateScope.Symbol`.
- [ ] `StateCascadeBridge.handleStateChange(event)` emits `GlobalStateChangedEvent` (carrying `profileId`, `key`, `prev`, `current`, `ts`) when `event.scope.kind === StateScope.Global`.
- [ ] `IndicatorCascadeBridge.handleIndicatorState(event)` ignores events whose `subscriptionId` is unbound.
- [ ] `IndicatorCascadeBridge.handleIndicatorState(event)` emits one `IndicatorChangedEvent` per state key (excluding `time`) on the first observation of a bound subscription, with `prev = null` and `current` wrapped as a `StateValue` of the matching `StateValueType`.
- [ ] `IndicatorCascadeBridge.handleIndicatorState(event)` on subsequent observations emits an `IndicatorChangedEvent` only for keys whose value differs from the prior observation for the same `(symbolId, period, instanceId, stateKey)` slot.

## End-to-end expectation

End-to-end e2e (`rules-bridges.e2e.test.ts`) drives the real `QuoteStreamService` + `PollingService` + `IndicatorService` + `InMemoryStateRepository` through their bridges and asserts the resulting `EvaluationTriggerEvent` stream: a polled-only symbol produces `BarOpened`/`BarClosed` (no `TickEvent`), a quote-subscribed symbol additionally produces a `TickEvent` per changed quote, and a state mutation produces a `SymbolStateChangedEvent` carrying the originating `profileId`.

The changed-only suppression is proven end-to-end through the wired engine (`rules-wire-engine.e2e.test.ts`): after a fire on the first tick, a second tick at the same price drives no orchestrator pass — no further rule/symbol event-log entries appear.

Critical failure mode: a re-poll of a still-forming bar must not duplicate `BarOpenedEvent` — the e2e drives two consecutive polls on the same forming bar and asserts a single `BarOpenedEvent` was observed.

## Out of scope

- The orchestrator wiring that subscribes the bridges to `QuoteStreamService` / `PollingService` / `StateRepository` / `IndicatorStreamService` and feeds the emitted events into the rules engine queue (#393).
- The tick ring buffer write driven by tick events (#389 series store; this bridge only emits).
- `TimerEvent` synthesis for `OncePerInterval` triggers (separate scheduler, already shipped in #391).
- Per-axis `DataUpdateEvent` translation — flows through a separate cache-fill path, not these bridges.
- Profile-based filtering of which rules see which events — owned by the orchestrator (#393).

## Surprises

(empty)
