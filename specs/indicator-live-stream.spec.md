# Spec: live indicator streaming

- Status: approved
- Touches:
  - `core` — `IndicatorStateEvent` type + `IndicatorStateListener` callback.
  - `engine` — `IndicatorStreamService` under `packages/engine/src/indicators/`; wired into `connectServices` (composite `onCandle` fans to the candle hub and the new service); a second `onIndicatorState` sink on `ConnectOptions`.
  - `api` — `IndicatorStreamHub` (mirrors `CandleStreamHub`, keyed by `subscriptionId`); extends `streamController` to handle `subscribe-indicator` / `unsubscribe-indicator` control messages over the same `/stream` socket; `app.types.ts` gains an `indicatorStream?: IndicatorStreamHub` field (required when the candle stream is wired — paired surface); `main.ts` constructs the hub and forwards events.
  - README — `api/README.md`'s Live candle stream section gains the new subscribe/unsubscribe shapes + frame examples.

## Goal

Push **computed indicator state** to subscribed clients as candles arrive, so a web chart can render live, updating indicator overlays.
The browser can't compute indicators itself (the `compute` logic stays server-side — only descriptors are serialized), and polling the historical endpoint on every tick would be wasteful.
This is the **live counterpart to #16**: provisional state on the forming candle, confirmed state on close, frames carrying `final` keyed off the candle's `final` flag.

## Domain model

`IndicatorStateEvent` (in `core`):

```ts
{
  subscriptionId: string;   // server-generated; identifies one client's subscription
  id: string;               // canonical symbol id
  period: Period;
  indicatorKey: string;
  state: IndicatorStatePoint;  // latest point only — { time, ...stateFields }
  final: boolean;           // mirrors the candle's `final`
}
```

`IndicatorStateListener = (event: IndicatorStateEvent) => void` — transport-agnostic sink (ADR-0005).

`IndicatorStreamService` (`engine`):

- Constructor: `(indicators: IndicatorRegistry, watchlist: WatchlistRepository, compute: IndicatorComputeService, options?: { onState?: IndicatorStateListener; newId?: () => string })`.
- `subscribe({ id, period, indicatorKey, inputs }): string` — server-generates a `subscriptionId` (nanoid), runs the full subscribe-time validation, stores the config, returns the id.
  Validation steps (the same checks `IndicatorComputeService.compute` runs at request time, **without loading candles**):
  - `watchlist.get(id)` → throw `SymbolNotFoundError` if not watched.
  - `registry.get(indicatorKey)` → throw `IndicatorNotFoundError` if missing.
  - `symbol.type ∈ definition.appliesTo` → throw `IndicatorError` on mismatch.
  - `validateIndicatorInputs(definition, inputs)` → throws `IndicatorError` on bad input.
- `unsubscribe(subscriptionId): void` — idempotent (no-op on unknown).
- `handleCandle(event: CandleEvent): Promise<void>` — for every subscription matching `(event.id, event.period)`: call `compute.compute(symbolId, indicatorKey, inputs, period)` (compute-from-earliest, full series), pick the row at `state.time === event.candle.time`, emit one `IndicatorStateEvent` per matching subscription via the `onState` callback.
- The subscription map is **in-process** and non-durable (same boundary as `BackfillJobService` and `CandleStreamHub`).
- Compute is **per subscription, not deduped** — two subscribers with identical configs each get an event; the underlying compute call runs twice. Optimize only on the second instance (per CLAUDE.md anti-dogma).

`IndicatorStreamHub` (`api`):

- Mirrors `CandleStreamHub`'s shape but keyed by `subscriptionId` instead of symbol id (a subscription belongs to one socket).
- `subscribe(subscriptionId, fn): () => void`, `publish(event)` — fan the event to subscribers of `event.subscriptionId`.

## API — the multiplexed `/stream` socket

The existing `/stream` route keeps its candle subscribe/unsubscribe.
Two **distinct new actions** for indicator subscriptions land on the same socket (clearer than overloading `subscribe`):

- `{ action: "subscribe-indicator", id, period, indicator: { key, inputs } }` — the server validates, calls `IndicatorStreamService.subscribe(...)`, replies with `{ subscriptionId, action: "subscribed-indicator", id, period, indicatorKey }`.
- `{ action: "unsubscribe-indicator", subscriptionId }` — the server calls `IndicatorStreamService.unsubscribe(...)` and clears the hub-side subscription for this socket.
- On each indicator state event for one of this socket's subscriptions: `{ subscriptionId, id, period, indicatorKey, state: { time, ... }, final }` (one frame per update).
- Validation failure at subscribe → `{ error: "<reason>" }` frame; no subscription opened (no `subscriptionId` returned).
- Socket close → unsubscribe everything (candle subscriptions + indicator subscriptions) — same lifecycle behavior the candle path already has.

## Acceptance criteria

`IndicatorStreamService` (fake `IndicatorRegistry` + fake `WatchlistRepository` + fake `IndicatorComputeService`, injected `newId`):

- [ ] `subscribe` with valid `(symbolId, period, indicatorKey, inputs)` returns the generated `subscriptionId` and persists the subscription (full-payload).
- [ ] `subscribe` for an unwatched symbol throws `SymbolNotFoundError` (no subscription stored).
- [ ] `subscribe` for an unknown indicator key throws `IndicatorNotFoundError`.
- [ ] `subscribe` with an asset-class mismatch throws `IndicatorError`.
- [ ] `subscribe` with invalid `inputs` throws `IndicatorError`.
- [ ] `handleCandle` for a `(symbolId, period)` with one subscription emits one `IndicatorStateEvent` whose `state` matches the row at the candle's time and whose `final` mirrors the candle's `final` (full-payload `toEqual`).
- [ ] `handleCandle` for `(symbolId, period)` with **no** matching subscriptions emits nothing.
- [ ] After `unsubscribe(subscriptionId)`, a subsequent `handleCandle` for the same `(symbolId, period)` emits nothing for that subscription.
- [ ] Two subscriptions on the same `(symbolId, period)` both receive events when a candle arrives (each carries its own `subscriptionId`).
- [ ] Confirmed (`final: true`) live state at a closed candle's `time` equals `IndicatorComputeService.compute(...)`'s row at that `time` — the live and historical paths agree (consistency).

`IndicatorStreamHub` (`api`):

- [ ] `publish` fans events to subscribers of `event.subscriptionId`, to no other id, and stops after unsubscribe (full-frame `toEqual`, mirrors the `CandleStreamHub` suite).

`/stream` route extensions (`api`):

- [ ] Sending `{ action: "subscribe-indicator", id, period, indicator: { key, inputs } }` over the socket responds with an ack frame containing the `subscriptionId`.
- [ ] After the ack, subsequent state events on the engine side are delivered as JSON frames to this socket only (not to a second socket subscribed to a different `subscriptionId`).
- [ ] `unsubscribe-indicator` stops frames for that subscription only; other subscriptions on the same socket are unaffected.
- [ ] A malformed indicator-subscribe message (missing fields, bad action) is answered with an error frame, not silently dropped.
- [ ] Closing the socket releases every indicator subscription on it (the engine's subscription map shrinks accordingly).

## End-to-end expectation

`packages/api/tests/e2e/indicator-stream.e2e.test.ts` over real Mongo (Testcontainers):

- Seed a watched crypto symbol and a few candles so SMA has data.
- Open `/stream` WebSocket, send `subscribe-indicator` for `sma` with `length: 3`, receive ack with `subscriptionId`.
- Trigger one polling sweep (real `PollingService` with a stub source producing a new candle); receive an indicator-state frame whose `state.time` matches the new candle's time, `state.value` matches the expected SMA, and `final` mirrors the candle's `final`.
- Critical failure mode: send `subscribe-indicator` with an unknown `indicator.key` → receive `{ error: "<reason>" }` and no subsequent state frames flow.

## Out of scope

- The chart UI itself.
- **Profile-bound subscriptions** (ad-hoc `{ key, inputs }` only; profile composition later).
- Incremental/stateful compute optimization (recompute over the full window per subscription per candle, for now).
- Persistence/caching of state results.
- Cross-subscription compute dedup (per "abstract on the second instance").
- A standalone REST endpoint to list active subscriptions (subscriptions are socket-local).

## Surprises

(Filled in retroactively if anything bites — empty by default.)
