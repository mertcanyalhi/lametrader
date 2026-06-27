# Spec: rule orchestrator wiring — live engine boot

- Status: draft
- Touches: `core` (`packages/core/src/rule-repository.types.ts`), `engine` (`packages/engine/src/connect.ts`, `packages/engine/src/rules/in-memory-rule-repository.ts`, `packages/engine/src/rules/mongo-rule-repository.ts`, `packages/engine/src/rules/rule-orchestrator.ts`, new `packages/engine/src/rules/live-evaluation-lookups.ts`, new `packages/engine/src/rules/cascade-error-handler.ts`, new `packages/engine/src/rules/mongo-event-log.ts`), `docs` (`docs/decisions/0012-rules-engine-architecture.md` amendment).

## Goal

Wire `RuleOrchestrator` into `connectServices` so rules fire on live candles, indicator updates, and quote changes after API start — closing the gap behind issue #290.
Inject a logger and a cascade error handler so failures surface both in the application log and as a synthetic `Error` rule event on the affected symbol (visible in the existing chart Events dialog).
Honor `Profile.enabled === false` as a runtime kill-switch so rules under a disabled profile never fire even when they're individually `enabled: true`.

## Acceptance criteria

Each bullet maps to exactly one test.

### `RuleRepository.listEnabledForSymbol`

- [ ] `listEnabledForSymbol(symbolId)` returns an `enabled: true` rule whose parent profile is `enabled: true`.
- [ ] `listEnabledForSymbol(symbolId)` excludes a rule whose own `enabled` is `false`.
- [ ] `listEnabledForSymbol(symbolId)` excludes a rule whose parent profile is `enabled: false`, even when the rule's own `enabled` is `true`.
- [ ] `listEnabledForSymbol(symbolId, profileId)` further restricts results to rules whose `profileId` matches (used for cascade events that carry their originating profile).
- [ ] `listEnabledForSymbol(null)` returns only `AllSymbols`-scoped enabled rules under enabled profiles (mirrors `listForSymbol(null)`).

### `RuleOrchestrator` filter switch

- [ ] On a non-cascade event, the orchestrator calls `listEnabledForSymbol(event.symbolId)` (no profile filter) so rules from every enabled profile are candidates.
- [ ] On a cascaded `SymbolStateChanged` / `GlobalStateChanged` event, the orchestrator calls `listEnabledForSymbol(event.symbolId, event.profileId)` so a profile-A write never wakes profile-B rules (regression check).
- [ ] Constructing `RuleOrchestrator` no longer accepts a `getActiveProfileId` option — the concept is dropped.

### `LiveEvaluationLookups`

- [ ] `record(event)` for an `OpenValueChanged` event updates the cache so `getOpenValue(event.symbolId)` returns `event.current`.
- [ ] `record(event)` for a `CurrentValueChanged` event updates the cache so `getCurrentValue(event.symbolId)` returns `event.current`.
- [ ] `record(event)` for an `IndicatorValueChanged` event updates the cache so `getIndicatorValue(event.instanceId, event.stateKey)` returns `event.current`.
- [ ] A `StateRepository.onStateChanged` mirror subscribed by the lookups updates `getSymbolState(profileId, symbolId, key)` to the latest written value.
- [ ] A `StateRepository.onStateChanged` mirror subscribed by the lookups updates `getGlobalState(profileId, key)` to the latest written value.
- [ ] All getters return `null` for entries that have never been observed.

### `CascadeErrorHandler`

- [ ] When `orchestrator.process(event)` rejects, the handler logs `{ err, event }` at level `error` via the injected logger with message `'rule orchestration failed'`.
- [ ] When `orchestrator.process(event)` rejects on an event that carries a `symbolId`, the handler appends one `Error` rule event to the symbol's `events[]` via `EventLog.appendSymbolEvent` with `ruleId: ''`, `symbolId: event.symbolId`, `ts: event.ts`, `type: Error`, and `reason: 'rule orchestration failed: <err.message>'`.
- [ ] When the synthetic-event write itself throws, the handler logs the secondary failure at level `error` with message `'failed to write cascade error event'` and resolves normally (no re-throw).
- [ ] When the rejecting event has no `symbolId` (TimerEvent), the handler logs the primary error but does not attempt a synthetic-event write (no target).

### `MongoEventLog`

- [ ] `appendSymbolEvent(symbolId, entry)` pushes `entry` onto the `watchlist.{_id}.events` array via `$push`.
- [ ] `appendRuleEvent(ruleId, entry)` pushes `entry` onto the `rules.{_id}.events` array via `$push`.
- [ ] `symbolEvents(symbolId)` reads the symbol document's `events` array in insertion order; missing field reads as `[]`.
- [ ] `ruleEvents(ruleId)` reads the rule document's `events` array in insertion order; missing field reads as `[]`.

### `connectServices` wiring

- [ ] `connectServices` accepts an optional `logger?: Pino.Logger` option that defaults to a silent Pino instance, so existing callers (CLI, tests) need no change to their `ConnectOptions`.
- [ ] After `connectServices` returns, sending one `CandleEvent` through the polling fan-out drives one complete pass through the rule chain: candle bridge emits → lookups cache updated → orchestrator processes → matching enabled rule's `NotifyTelegram` action runs → the symbol's `events[]` carries one `Fired` entry.
- [ ] The polling fan-out's previous `void indicatorStream.handleCandle(event)` is replaced with the `.catch((err) => log.error({ err, event }, 'indicator stream failed'))` pattern — no silent swallow remains.
- [ ] The polling fan-out's previous `void quoteStream.handleCandle(event)` is replaced with the `.catch((err) => log.error({ err, event }, 'quote stream failed'))` pattern — no silent swallow remains.

### ADR amendment

- [ ] `docs/decisions/0012-rules-engine-architecture.md` carries a new dated section (mirroring the existing 2026-06-27 firing-state amendment) documenting (a) the cascade error pattern with `ruleId: ''` sentinel + recursive-write guard, (b) the decision that multi-profile fire is default (no active-profile concept), (c) the decision that `profile.enabled === false` suppresses runtime firing of all child rules.

## End-to-end expectation

**Happy path** — boot → poll → fire:

1. `connectServices` is wired against an in-memory database with one watched symbol (`stock:AAPL`), one enabled profile (`profile-1`, `enabled: true`), and one enabled rule under that profile with `scope: Symbol(AAPL)`, condition `current > 0`, trigger `Once`, action `NotifyTelegram(destination: "main", template: "fired")`.
2. A single live `CandleEvent` for `AAPL` close=105 flows through the polling fan-out.
3. After the serialized chain drains:
   - The notifier has received exactly one delivery (`{destinationName: "main", body: "fired"}`).
   - The symbol's `events[]` (read via `watchlist.get(AAPL)`) carries one `Fired` entry referencing the rule and the symbol.
   - The rule's `events[]` (read via `rules.get(rule-id)`) carries the same `Fired` entry.

**Critical failure mode** — orchestrator throws:

1. The same boot, but the rule repository is wrapped to throw on the next `listEnabledForSymbol` call (simulating a Mongo outage).
2. A `CandleEvent` for `AAPL` flows through.
3. The cascade error handler:
   - Logs one `error` entry with `{ err, event }` and message `'rule orchestration failed'`.
   - Appends one `Error` rule event to `AAPL`'s `events[]` with `ruleId: ''`, `symbolId: 'stock:AAPL'`, `type: Error`, and `reason` containing the error message.
4. The chain is not poisoned: with the throwing wrapper disengaged, the next `CandleEvent` fires the rule normally and the symbol's `events[]` ends with one `Error` entry followed by one `Fired` entry.

## Out of scope

- An "active profile" / `getActiveProfileId` concept — explicitly dropped. Multi-profile fire is the default.
- Auto-subscribing every profile indicator instance to `IndicatorStreamService` on boot so indicator-driven rules fire automatically. The bridge is wired (a future server-side subscription mechanism will feed it), but instances are not auto-subscribed in this change. Indicator-state subscriptions remain client-driven (chart WebSocket), as today.
- A new UI surface for cascade Error events — `events-dialog.tsx` already renders `RuleEventType.Error` via `event.reason`.
- New event kinds beyond what the three bridges already emit.
- Performance work on the serialized rule chain — single-tenant scale is the target.
- Backtesting wiring — this is a live-event-only fix.
- Reviving the abandoned `feat/rules-page-create` branch — its review findings are explicitly avoided by this design.

## Surprises

_(Filled in retroactively after implementation.)_
