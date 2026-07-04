# Spec: web chart indicator overlays — live updates

- Status: draft
- Touches:
  - `packages/ui/src/lib/stream/stream-client.{ts,types.ts}` — add an `Indicator` kind to the shared `/stream` client so the existing socket multiplexes `subscribe-indicator` alongside candle + quote subscriptions.
  - `packages/ui/src/lib/stream/use-stream-subscription.ts` — extend so the indicator kind threads through unchanged (or add a sibling `useIndicatorStreamSubscription` if the structured args don't fit).
  - `packages/ui/src/lib/hooks/indicators.ts` — new `useIndicatorStream({ id, period, key, inputs })` hook that returns the latest live state row + `final` flag for one `(id, period, key, inputs)` subscription.
  - `packages/ui/src/pages/chart/candle-chart.tsx` — for each rendered overlay, subscribe over the shared client and apply each `IndicatorStateEvent` to the line series' last point via `series.update(...)`.

## Goal

Make the chart's indicator overlays tick live: each rendered overlay subscribes to `subscribe-indicator` on `/stream` for its `(id, current period, key, inputs)`, and incoming `IndicatorStateEvent`s update its line series' last point — forming bars update in place, `final: true` bars close the same point.
Symbol/period changes re-subscribe at the new tuple; removing an overlay (or unmounting the chart) unsubscribes.

## Acceptance criteria

Each bullet maps to exactly one test.

### `StreamClient` — add the `Indicator` kind

- [ ] `subscribe(StreamKind.Indicator, { id, period, indicator: { key, inputs } }, listener)` sends one `{ action: 'subscribe-indicator', id, period, indicator: { key, inputs } }` frame, captures the server's `subscribed-indicator` reply, then delivers each subsequent `IndicatorStateEvent` (matched by the server-assigned `subscriptionId`) to the listener.
- [ ] On unsubscribe, the client sends `{ action: 'unsubscribe-indicator', subscriptionId }` (only if the server reply was seen) and stops delivering further frames to that listener.
- [ ] Two listeners on the same `(id, period, key, inputs)` share one upstream subscription (only the first listener sends `subscribe-indicator`; only the last listener's release sends `unsubscribe-indicator`).
- [ ] On reconnect, the client replays each active indicator subscription's `subscribe-indicator` and re-binds the new `subscriptionId` so frames keep routing.

### `useIndicatorStream` — the React surface

- [ ] Returns `null` before any frame arrives.
- [ ] After an `IndicatorStateEvent` for its `(id, period, key, inputs)` arrives, returns `{ state, final }` (the event's last state row + closed flag).
- [ ] Changing `id` or `period` discards any prior tuple's frame: reads `null` until the new tuple's first frame (no stale state under the new key).

### `CandleChart` — apply live state to the series + legend

- [ ] For each overlay (Number/Line state descriptor), an incoming live state event calls `series.update({ time: event.state.time, value: event.state[stateKey] })` on the matching line series — once per event.
- [ ] When no crosshair is active, the legend's value column for each overlay reflects the latest live state event (mirroring the OHLCV header's live tick), and falls back to the historical compute tail when no live event has yet arrived.
- [ ] Removing an overlay (it leaves the `overlays[]` prop) tears down its indicator subscription (no further frames are applied for that instance).
- [ ] Reuses the same shared `/stream` client as the candle subscription — no second WebSocket is opened by the live indicator path.

## End-to-end expectation

The web build (`packages/ui/tests/e2e/build.e2e.test.ts`) stays clean — `npm run build -w @lametrader/ui` is the only e2e gate the web package carries.
The component-level happy path lives in unit tests (jsdom + mocked WebSocket) per the issue's "Component test" criterion.

## Out of scope

- Touching the engine / API — `subscribe-indicator` already exists server-side (#17, #43).
- Persisting subscription state across reloads.
- Multi-state-descriptor overlays beyond the existing `Number` / `Line` and `Enum` / `Markers` rendering surfaces (markers don't have a "last point" to update — they stay historical-only).

## Surprises

(empty — fill retroactively if anything bites)
