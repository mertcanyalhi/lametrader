# @lametrader/web

Browser app for the lametrader platform — a Vite/React/TypeScript driving adapter that talks to the `@lametrader/api` REST + WebSocket surfaces behind an nginx `/api/*` proxy.

The shell (sidebar + topbar + theme + Radix Themes), the routing, the TanStack Query + `apiFetch` data layer, and the logging conventions are documented in [`CLAUDE.md`](./CLAUDE.md) — read that first if you are extending the UI.

## Status bar

A persistent bottom status bar renders on every page beneath `<main>` (a `contentinfo` landmark).
It carries global, always-available controls; today that is the **profile selector**.

The selector lists the platform's profiles (`GET /api/profiles`) and shows the active one on its trigger.
Picking a profile sets the **currently selected profile** — a global app concept that later drives chart indicator overlays — and persists the choice to `localStorage` so it survives reloads.

- **Source of truth** — only the selected profile *id* is client state, held in the `useSelectedProfile()` store and persisted to `localStorage`; the profile objects themselves are server state (`useProfiles()`).
- **First-run / recovery** — once profiles load, a stored id that no longer names a listed profile (or no stored id at all) resolves to the first **enabled** profile; with no profiles the trigger reads "No profile" and is disabled.
- A disabled profile is still listed and selectable, shown with a muted "(disabled)" hint.

Profile create / edit / delete management, and the chart contributing its symbol + period controls to this bar (plus `?profile=` URL sync), land in follow-up iterations of the same issue.

## Pages

### `/` — Watchlist

The home page: a dense, sortable table of the symbols you watch, each with its latest price and change.
Sort by symbol, type, price, or change.
Add a symbol by searching for an instrument, edit which timeframes it's tracked on, or remove it — each confirmed with a toast.
A symbol with no price yet shows a dash.

Backfill historical candles from a symbol's row actions (or right after adding it): pick periods and an optional date range, watch each job's live progress, and retry on failure.

Each visible row ticks live: on mount it subscribes to the symbol's quote feed over the shared `/stream` socket and updates its price/change/change-% in place, with the price cell flashing green (up) or red (down) on each move (suppressed under `prefers-reduced-motion`).
Leaving the page tears the subscriptions down; returning re-subscribes from the current snapshot.
If the socket drops, the shared client reconnects with backoff and replays the active subscriptions, and the watchlist refetches its snapshot so the rows resync.

### `/chart` — Chart

A candlestick chart of one watched symbol on one timeframe, rendered with `lightweight-charts`.
The symbol and period live in the URL (`/chart?id=&period=&range=`), so a chart is shareable and the browser's back/forward buttons navigate between views; a bare `/chart` opens the first watched symbol on your last-selected period (falling back to the config default), or sends you to the watchlist when nothing is watched.
A top-left overlay shows the symbol summary (description · period · exchange) and the inspected candle's open/high/low/close, change, and volume — the candle under the crosshair, or the latest one otherwise.
A bottom action bar holds the symbol picker (a searchable dialog; instruments outside your watchlist appear faded and can't be charted) and the period + date-range dialog.
Crypto and equities get a volume sub-pane; FX (no volume) omits it.
Candle and volume colors follow the app theme and update live when you toggle it.
Scrolling back in time loads older history a window at a time until the start of what's stored; a symbol with no stored candles shows a "Run backfill" card that fetches history without leaving the page.
The visible date range and selected period persist (localStorage), so switching symbols and reloads keep your view.

The chart ticks live: it subscribes to the symbol's candle feed over the shared `/stream` socket and applies each candle for the charted period to the series in place — updating the forming bar when the time matches, appending when it's newer — so the latest bar (and the overlay's price header / document title) track the stream. Changing symbol or period re-subscribes; leaving the page tears the subscription down.

Indicator overlays land in follow-up issues.

### `/settings` — Settings (this README's focus)

Read/write the platform configuration (`GET` / `PUT /api/config`).

**Surface controls**

- **Periods** — a multi-select toggle bar (Radix Primitives `ToggleGroup`, `type=multiple`) rendered as a trading-platform timeframe bar: `1m 5m 15m 30m 1h 4h 1d 1w`.
  A pressed toggle = an enabled period.
- **Default period** — a Radix Themes `Select` whose options are only the **currently-enabled** periods.
  Toggling a period off in the bar removes it as a `defaultPeriod` option and clears the selection if the toggled-off period was the active default (mirrors `parseConfig`'s `defaultPeriod ∈ periods` rule for instant client feedback).
- **Save** — Radix Themes `Button`, disabled until the form is dirty.
  Submits the full payload via `PUT /api/config`.

**Validation**

The form reuses `@lametrader/core`'s `parseConfig` through a custom react-hook-form resolver (`src/lib/parse-config-resolver.ts`).
The same module the backend enforces — no zod, no client-side rule duplication.
A thrown `ConfigError` becomes a form-level error rendered inline as a Radix Themes `Callout`.

**Feedback**

- Success → a sonner toast (`Settings saved`).
- A server-rejected save (4xx with `{ error: string }`) → the server's message rendered inline as a `Callout color="red"` above the form footer.
- Initial-load failure → an inline `Callout` with the server message; the form is not rendered.
- Initial-load pending → a Radix Themes `Skeleton` placeholder.

## Hooks

`src/lib/hooks/use-config.ts` exposes:

- `useConfig()` — `GET /api/config` via TanStack Query under key `['config']`.
- `useUpdateConfig()` — `PUT /api/config`; on success, writes the response straight into the `['config']` cache so any subscriber re-renders without a follow-up round-trip.

`src/lib/hooks/symbols.ts` exposes the watchlist data layer (read the watched symbols, search instruments, add/edit-periods/remove).

`src/lib/hooks/candles.ts` exposes `usePagedCandles` — the chart's historical candle feed, which loads a symbol/period's bars a time window at a time and walks the window backward through history as you scroll.

`src/lib/hooks/profiles.ts` exposes `useProfiles()` — `GET /api/profiles` via TanStack Query under key `['profiles']`, backing the status-bar profile selector.
The selected-profile *id* is client state, owned by `src/lib/selected-profile/` (a `localStorage` store + a React Context exposing `useSelectedProfile()`), and reconciled against the fetched list by `resolveSelectedProfileId`.

Both modules go through the package's `apiFetch` wrapper, so logging + `ApiError` mapping happen at the boundary, not at each call site.

### Live `/stream` client

`src/lib/stream/` holds the shared real-time client over the multiplexed `GET /api/stream` WebSocket.
A single module-level socket (`stream-client.ts`) backs the whole app: subscriptions are ref-counted by `(kind, id)`, so many components can watch the same symbol over one connection, and the socket opens on the first subscription and closes once the last one is released.
It hides the protocol's asymmetry — candle subscriptions are keyed by the client's symbol `id`, quote subscriptions by the server-assigned `subscriptionId` learned from the `subscribed-quote` reply — behind one `subscribe(kind, id, listener)` call, and reconnects with exponential backoff, replaying the active subscriptions and firing `onReconnect` listeners so consumers can resync.

- `useStreamSubscription(kind, id, onEvent)` — the typed React primitive: subscribe for the component's lifetime, re-subscribing on `id` change.
- `useQuoteStream(id)` — the latest live quote for a symbol (used by each watchlist row), `null` until the first frame.
- `useCandleStream(id)` — the latest live candle event for a symbol (used by the chart); the feed spans every polled period, so `liveCandleForPeriod` filters it to the charted one.

`new WebSocket(...)` is never called from a component — only through this client (see `web/CLAUDE.md`).

## Develop

```bash
# Dev server (Vite, port 5173, proxies /api → :3000)
npm run dev -w @lametrader/web

# Production build → packages/web/dist
npm run build -w @lametrader/web

# Type-check only (picked up by the root `npm run typecheck`)
npm run typecheck -w @lametrader/web

# Unit tests (component + hook tests in jsdom)
npm test
```

## Test tiers

- **Unit** — co-located `*.test.{ts,tsx}` next to the source. jsdom environment via the file-level `// @vitest-environment jsdom` directive.
  RTL `cleanup()` + `vi.restoreAllMocks()` in `afterEach`.
  Mock at the `fetch` boundary so the real `apiFetch` + `QueryClient` + RHF resolver are exercised.
- **E2E** — at the HTTP boundary, in `packages/api/tests/e2e/`.
  The settings page's contract is pinned by `packages/api/tests/e2e/settings-page.e2e.test.ts` (happy path + the 400 critical failure); the watchlist page's by `watchlist-page.e2e.test.ts` (the discover → add → enriched-list → edit → remove round-trip + the 404 failure); the chart page's by `chart-page.e2e.test.ts` (the backfill → windowed candle read + the empty-window state).
  No browser harness — page-level behaviour is covered by the unit tier.
