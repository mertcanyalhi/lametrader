# Spec: chart rule-events live stream

- Status: approved
- Touches:
  - `core` — `EventLog` port gains an `onAppend(listener)` subscription seam.
  - `engine` — `MongoEventLog` + `InMemoryEventLog` emit on each successful append; `ConnectOptions` gains an optional `onRuleEvent(entry, target)` sink; `connect.ts` wires `eventLog.onAppend` → `options.onRuleEvent`.
  - `api` — `LiveStream` gains a `ruleEventStream: StreamHub<RuleEventEntry>`; new `ruleEventSubscriptionKind` (sync, symbolId-keyed, mirrors candle); registered on the existing `/stream` route.
  - `web` — `StreamKind.RuleEvent` + `StreamEventMap[RuleEvent] = RuleEventEntry` + `subscribe-rule-event` / `unsubscribe-rule-event` verbs in `stream-client.ts`; new `useRuleEventStream(symbolId)` hook in `lib/hooks/rule-events.ts`; `ChartLayout` calls it once; the 5s polling stopgap on `useStateChangeMarkers` is removed.

## Goal

Push every newly-appended `RuleEventEntry` for a charted symbol from the engine to the web client over the existing `/stream` socket, so the chart's `useStateChangeMarkers` and the Events dialog see new entries within network RTT — no tab refocus, no polling.
Same pattern as the candle/quote/indicator live pipelines so the next engineer adds one more verb, not a new mechanism.
Subsumes the temporary 5 s `refetchInterval` stopgap added in #377; that's removed in the same change.

## Domain model

`EventLog.onAppend` (in `core`):

```ts
/** Subscribe to every successful append; returns an unsubscribe. */
onAppend(listener: (
  entry: RuleEventEntry,
  target: { kind: 'rule'; ruleId: string } | { kind: 'symbol'; symbolId: string },
) => void): () => void;
```

The listener is invoked after the underlying write succeeds, with the stamped `entry` (so `firedAt` is set) and a discriminated `target`.
Each fire mirrors to two appends (rule + symbol), so the listener is invoked twice per fire with the same entry and different `target.kind` — by design; callers filter to the side they care about.

`ConnectOptions.onRuleEvent` (in `engine`):

```ts
onRuleEvent?: (
  entry: RuleEventEntry,
  target: { kind: 'rule'; ruleId: string } | { kind: 'symbol'; symbolId: string },
) => void;
```

Forwarded directly from `eventLog.onAppend` when supplied.

`ruleEventStream: StreamHub<RuleEventEntry>` (in `api`), keyed by `symbolId`.
The composition root in `api/src/main.ts` passes `onRuleEvent: (entry, target) => { if (target.kind === 'symbol') ruleEventStream.publish(target.symbolId, entry); }`.

`ruleEventSubscriptionKind` (in `api`): sync acquire, no upstream service, no race-check — same shape as `candleSubscriptionKind`.
WS verbs:

- `{ action: 'subscribe-rule-event', id }` — server replies via fan-out (no ack; mirrors candle).
- `{ action: 'unsubscribe-rule-event', id }` — releases the hub subscription for that key on this socket.
- Inbound frames are the bare `RuleEventEntry` plus `{ symbolId }` so the client can route by key without re-deriving it.

`StreamKind.RuleEvent` (in `web`):

- Wire frame: `{ symbolId: string; entry: RuleEventEntry }`.
- `StreamEventMap[StreamKind.RuleEvent] = RuleEventEntry` (the hook delivers the entry).
- `StreamSubscribeKey<StreamKind.RuleEvent>` falls back to `string` (the symbol id).

`useRuleEventStream(symbolId)` (in `web`): on each frame, prepend the `entry` into the markers query cache (capped at `MARKER_PAGE_SIZE`) and invalidate the events-dialog infinite query so an open dialog refetches.

## Acceptance criteria

`InMemoryEventLog.onAppend`:

- [ ] After `appendSymbolEvent`, the listener is invoked once with the stamped entry and `target = { kind: 'symbol', symbolId }` (full-payload `toEqual`).
- [ ] After `appendRuleEvent`, the listener is invoked once with the stamped entry and `target = { kind: 'rule', ruleId }`.
- [ ] An unsubscribe stops further calls — a subsequent append fires nothing.
- [ ] Two listeners both receive each append, independently of one another.

`MongoEventLog.onAppend` (live tier, against real Mongo):

- [ ] After `appendSymbolEvent` succeeds, the listener is invoked once with the persisted entry and the matching `target`.
- [ ] An unsubscribe stops further calls.

Engine `connectServices`:

- [ ] When `options.onRuleEvent` is supplied, an `eventLog.appendSymbolEvent` call invokes it once with the entry and `{ kind: 'symbol', symbolId }`.

`StreamHub` is already covered; no new hub tests.

API `ruleEventSubscriptionKind`:

- [ ] `validateSubscribe({action: 'subscribe-rule-event', id})` returns `{input: {id}}`.
- [ ] `validateSubscribe` with missing `id` returns an `{error}`.
- [ ] `acquire({id})` returns `{key: id}` synchronously.
- [ ] `subscribeHub` registers on the hub and a subsequent `publish(id, entry)` fans the JSON frame `{symbolId: id, entry}` to the socket.

API `/stream` route (covered by existing `SubscriptionRegistry` shape; one e2e on the socket flow):

- [ ] Sending `{action: 'subscribe-rule-event', id}` makes a subsequent `ruleEventStream.publish(id, entry)` arrive as `{symbolId, entry}` on that socket only.

Web `useRuleEventStream` (component test, FakeWebSocket pattern from `candles.test.ts`):

- [ ] On mount, sends `{action: 'subscribe-rule-event', id}` over the socket.
- [ ] An inbound `{symbolId, entry}` frame for the watched id prepends `entry` into the markers query cache (full-payload `toEqual` on the new cached array).
- [ ] An inbound frame prepended past the `MARKER_PAGE_SIZE` cap truncates the cache to that size.
- [ ] An inbound frame also invalidates the events-dialog infinite query under the same symbol (the next infinite-query fetch re-runs).
- [ ] On unmount, sends `{action: 'unsubscribe-rule-event', id}`.

Web `useStateChangeMarkers`:

- [ ] The hook no longer sets `refetchInterval` — the existing render-on-data tests stay green.

## End-to-end expectation

`packages/api/tests/e2e/rule-event-stream.e2e.test.ts`, running over the real `LiveStream` bundle on an in-memory app (no Mongo needed — the hub fires synchronously):

- Open `/stream`, send `{action: 'subscribe-rule-event', id: 'crypto:BTCUSDT'}`.
- Publish a `StateSet` entry via `ruleEventStream.publish('crypto:BTCUSDT', entry)`.
- Assert the client received `{symbolId: 'crypto:BTCUSDT', entry}` as a single frame (full-payload `toEqual`).
- Send `{action: 'unsubscribe-rule-event', id: 'crypto:BTCUSDT'}`, publish again, assert no further frame.
- Critical failure mode: a `subscribe-rule-event` with a missing `id` is answered with an `{error}` frame, not silently dropped, and no later publish fans to this socket.

## Out of scope

- Rule-id-keyed streaming (chart is symbol-keyed; rule-side dashboards reuse the same pattern when needed).
- Server-side filtering by event type (markers filter to `StateSet` client-side; full set keeps the dialog complete).
- Per-subscription event back-pressure or batching (one entry per frame, like candle).
- Re-implementing the events-dialog infinite query as a stream-driven cache mutation — invalidate is one line and Right Enough today.
- Removing the existing REST endpoint that backs the markers query — it stays the cold-load source of truth.

## Surprises

(Filled in retroactively if anything bites — empty by default.)
