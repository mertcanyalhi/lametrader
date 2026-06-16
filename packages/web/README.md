# @lametrader/web

Browser app for the lametrader platform — a Vite/React/TypeScript driving adapter that talks to the `@lametrader/api` REST + WebSocket surfaces behind an nginx `/api/*` proxy.

The shell (sidebar + topbar + theme + Radix Themes), the routing, the TanStack Query + `apiFetch` data layer, and the logging conventions are documented in [`CLAUDE.md`](./CLAUDE.md) — read that first if you are extending the UI.

## Pages

### `/` — Watchlist

The home page: a dense, sortable table of the symbols you watch, each with its latest price and change.
Sort by symbol, type, price, or change.
Add a symbol by searching for an instrument, edit which timeframes it's tracked on, or remove it — each confirmed with a toast.
A symbol with no price yet shows a dash.

Backfill historical candles from a symbol's row actions (or right after adding it): pick periods and an optional date range, watch each job's live progress, and retry on failure.

Live price ticking lands in a separate task.

### `/chart` — Chart

A TradingView-style candlestick chart of one watched symbol on one timeframe.
The symbol and period live in the URL (`/chart?id=&period=`), so a chart is shareable and the browser's back/forward buttons navigate between views; a bare `/chart` opens the first watched symbol on the default period (or sends you to the watchlist when nothing is watched).
The toolbar picks the symbol and timeframe — timeframes the symbol isn't tracked on are disabled with a hint — and shows the symbol's latest price and change.
Crypto and equities get a volume sub-pane; FX (no volume) omits it.
Candle and volume colors follow the app theme and update live when you toggle it.
Scrolling back in time loads older history a window at a time until the start of what's stored; a symbol with no stored candles shows a "Run backfill" card that fetches history without leaving the page.

Live candle ticks and indicator overlays land in follow-up issues.

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

Both modules go through the package's `apiFetch` wrapper, so logging + `ApiError` mapping happen at the boundary, not at each call site.

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
