# Spec: web watchlist live quotes — shared `/stream` client + ticking + flash (#41)

- Status: implemented
- Touches: `web` only.
  New shared `/stream` client (`src/lib/stream/*`): a singleton connection
  manager over one shared `WebSocket`, a generic `useStreamSubscription`
  primitive, and `useQuoteStream(id)` built on it.
  `watchlist-row.tsx` mounts `useQuoteStream`; `price-cell.tsx` flashes on a
  direction change.
  Backend untouched — `/stream`'s `subscribe-quote` feed (`#36`) already exists.

## Goal

Make the watchlist tick live: layer real-time price/change updates onto the
static table via the `/stream` `subscribe-quote` feed, with a green/red flash on
each tick.
This task also lands the **shared `/stream` WebSocket client** — the watchlist
is the first live consumer, so the connection manager lives here and the
chart-live task (`#42`) reuses it ("abstract on the second instance").

## Background — the `/stream` protocol (already built, `#36`)

One multiplexed socket carries several subscription kinds.
This task uses two of them; both ride the same socket:

- **Candle** (used by `#42`, but the shared client supports it now): client sends
  `{ action: 'subscribe', id }`, the server forwards each `CandleEvent`
  (`{ id, period, candle, final }`) for that id, and the client stops with
  `{ action: 'unsubscribe', id }`.
  Keyed by `id`; frames are matched by `id`.
- **Quote**: client sends `{ action: 'subscribe-quote', id }`, the server replies
  once with `{ action: 'subscribed-quote', subscriptionId, id, period }`, then
  streams `SymbolQuoteEvent` frames
  (`{ subscriptionId, id, period, quote: { price, change, changePct, time }, final }`).
  The client stops with `{ action: 'unsubscribe-quote', subscriptionId }`.
  Keyed by the **server-generated `subscriptionId`** — the client only learns it
  from the async `subscribed-quote` reply.

The asymmetry (candle keyed by client `id`, quote keyed by server `subscriptionId`)
is the central thing the connection manager hides behind one uniform
`subscribe(kind, id, listener)` API.

## Design — the shared connection manager (`src/lib/stream/stream-client.ts`)

A framework-agnostic module singleton (no React) so a single socket is shared
process-wide and the hooks stay thin.

- **One lazily-opened socket.** The first `subscribe(...)` opens
  `new WebSocket(<origin>/api/stream)` (reusing `json-socket`'s `toWsUrl`); the
  socket closes once the last subscription is released.
- **Ref-counted logical subscriptions** keyed `candle:<id>` / `quote:<id>`.
  Many local listeners can share one upstream subscription; the upstream
  subscribe frame is sent when the **first** listener for a key arrives and the
  upstream unsubscribe when the **last** one leaves.
- **Frame routing.** A frame carrying `candle` routes to `candle:<frame.id>`
  listeners; a `subscribed-quote` reply records the `subscriptionId` for
  `quote:<id>` (and a `subscriptionId → key` index); a frame carrying `quote`
  routes via that index. `{ error }` frames are logged; unknown frames ignored.
- **Send timing.** Frames are only written when the socket is `OPEN`; otherwise
  the subscription sits in the registry and is (re)sent from the `open` handler,
  which replays a subscribe for every active key. So no explicit outbound queue.
- **Reconnect with backoff.** An unexpected `close` schedules a reconnect with
  exponential backoff (`base · 2^attempts`, capped); on reopen every active key
  is re-subscribed (quote keys re-correlate fresh `subscriptionId`s) and
  registered reconnect listeners fire — so a consumer can resync its snapshot.

React layer:

- **`useStreamSubscription(kind, id, onEvent)`** — subscribes on mount / `id`
  change, unsubscribes on unmount, via the manager. The generic primitive both
  `useQuoteStream` and (`#42`) `useCandleStream` build on.
- **`useQuoteStream(id)`** — returns the latest `SymbolQuoteEvent['quote']` for
  the id (or `null` before the first frame), re-subscribing on `id` change.

Watchlist wiring:

- **`watchlist-row.tsx`** mounts `useQuoteStream(symbol.id)`; each frame updates
  the row's `price` / `change` / `changePct` over the `#37` snapshot baseline.
- **`price-cell.tsx`** flashes the price cell green (up) / red (down) for ~400 ms
  when the price moves vs. its previous render, clearing afterward; honors
  `prefers-reduced-motion` (no flash animation when the user opts out).
- On reconnect the watchlist invalidates its enriched query so rows resync from a
  fresh `?enrich=true` snapshot (the manager's reconnect hook drives it).

## Acceptance criteria

Each bullet maps to exactly one test (jsdom; a controllable fake `WebSocket`
global, mirroring `backfill-dialog.test.tsx`).

Connection manager (`stream-client.ts`):

- [ ] The first `subscribe('quote', id, fn)` opens exactly one `WebSocket` and
      sends `{ action: 'subscribe-quote', id }`; a second `subscribe` for a
      different id reuses the **same** socket (one instance created).
- [ ] After a `subscribed-quote` reply, a following `SymbolQuoteEvent` frame is
      delivered to the quote listener; releasing the subscription sends
      `{ action: 'unsubscribe-quote', subscriptionId }` with the server id.
- [ ] A candle subscription delivers `CandleEvent` frames matched by `id` to its
      listener; releasing it sends `{ action: 'unsubscribe', id }`.
- [ ] Two listeners on the same `quote:<id>` share one upstream
      `subscribe-quote`; the upstream `unsubscribe-quote` fires only when the
      second (last) listener is released.
- [ ] An unexpected socket `close` triggers a reconnect that opens a new socket,
      replays the active subscribe frame(s), and invokes registered
      `onReconnect` listeners.

Hooks + components:

- [ ] `useQuoteStream(id)` exposes the latest frame's `quote` and returns `null`
      before any frame; changing `id` unsubscribes the old and subscribes the new.
- [ ] `price-cell.tsx` adds the up (green) flash class when the price rises vs.
      the previous render and the down (red) class when it falls, and renders no
      flash class under `prefers-reduced-motion`. (Assert the full class state.)
- [ ] A `WatchlistRow` rendered with a snapshot quote updates its Price / Chg /
      Chg % cells when a live `SymbolQuoteEvent` arrives over the (mocked) stream.
- [ ] On a stream reconnect, the watchlist invalidates its enriched query
      (`WATCHLIST_QUERY_KEY`) so rows resync from a fresh `?enrich=true` snapshot
      (driven by the manager's `onReconnect` hook).

## End-to-end expectation

The server `/stream` `subscribe-quote` path already has its API e2e
(`packages/api/tests/e2e/quote-stream.e2e.test.ts`, `#36`).
The browser-side e2e is the web build (`packages/web/tests/e2e/build.e2e.test.ts`)
staying green with the live-quotes code compiled into the bundle.

The end-user happy path — a watchlist row whose price ticks and flashes on a
streamed quote — is asserted by the jsdom component test above (mocked socket),
which is the realistic surface for a browser-only feature.

## Out of scope

- Chart / indicator stream consumers — `#42` reuses this client in its own task.
- The static table / CRUD (`#37`).
- Replaying history to a late subscriber (the feed is live-only).
- Authentication / per-client rate limiting on the socket.

## Surprises

- **Sole-subscriber id change churns the socket.** Because the socket closes
  when the last subscription is released, a component that is the *only*
  subscriber and changes its `id` (e.g. the future chart switching symbols)
  releases the old subscription — closing the socket — then opens a fresh one
  for the new id. For the watchlist this never happens (rows mount/unmount;
  others keep the socket open), but the lifecycle test asserts the close+reopen
  so the behaviour is pinned, not accidental.
- **The module singleton leaks state across same-file tests.** `streamClient` is
  one instance per test *file* (Vitest isolates files), but persists across
  tests within a file — its `everOpened` flag and open socket survive between
  tests. Component/hook tests must `cleanup()` in `afterEach` so unmounting
  releases subscriptions and closes the socket; the manager's own behaviour
  tests use isolated `createStreamClient()` instances instead.
- **jsdom has no `WebSocket`.** Any test that renders a row (hence
  `useQuoteStream`) must either stub the global `WebSocket` or mock the
  stream-client module — otherwise `new WebSocket(...)` throws. The existing
  `watchlist-page.test.tsx` mocks the module (its rows don't exercise the live
  path); `watchlist-row.test.tsx` stubs the global to drive a real tick.
