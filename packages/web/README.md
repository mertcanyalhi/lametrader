# @lametrader/web

Browser app for the lametrader platform — a Vite/React/TypeScript driving adapter that talks to the `@lametrader/api` REST + WebSocket surfaces behind an nginx `/api/*` proxy.

The shell (sidebar + topbar + theme + Radix Themes), the routing, the TanStack Query + `apiFetch` data layer, and the logging conventions are documented in [`CLAUDE.md`](./CLAUDE.md) — read that first if you are extending the UI.

## Pages

### `/` — Watchlist

A dense, sortable table of watched symbols with their **snapshot** quote, plus the management flows.
Live ticking (flashing cells, the shared `/stream` client) lands in a separate task.

**The table**

- Bound to `GET /api/symbols?enrich=true` via `useWatchlist()`.
- Columns: **Symbol** (`id` mono + muted `description`) · **Type** (`Badge`) · **Price** · **Chg** · **Chg %** · **Periods** (chips) · **Actions**.
- Numeric columns are `tabular-nums`; change/change-% are coloured green/red/gray by sign.
  A `null` quote (no snapshot computable) renders an em dash (`—`).
- **Sortable headers** — Symbol, Type, Price, Chg %.
  Default sort is Symbol ascending; clicking the active column flips the direction (`aria-sort` reflects it).
- Loading → skeleton rows; empty → a "No symbols watched yet" card with a **Watch a symbol** button; load failure → a red `Callout`.

**Management flows** (each shows a sonner toast on success; an API `{ error }` surfaces as an error toast)

- **Add** — a toolbar **Add symbol** button opens a `Dialog` with a debounced instrument search (`GET /api/instruments?q=…&type=…`), an asset-class filter, and a radio-selectable results table.
  Selecting a result and confirming issues `POST /api/symbols` with `periods` defaulted from the config.
- **Edit periods** — the row's period chips (or the actions menu) open a `Popover` with a timeframe toggle bar over the config's periods.
  Saving issues `PATCH /api/symbols/:id` with the selection sorted into timeframe order.
- **Remove** — the row's actions menu opens an `AlertDialog` that names the symbol; confirming issues `DELETE /api/symbols/:id`.

Each mutation invalidates the `['symbols', 'enrich']` query so the table refetches.

### `/chart` — Chart

Boilerplate placeholder.
The candlestick chart + indicator overlays land in follow-up issues.

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

`src/lib/hooks/symbols.ts` exposes the watchlist data layer (all under the `['symbols', 'enrich']` key, which the mutations invalidate):

- `useWatchlist()` — `GET /api/symbols?enrich=true`; the enriched rows the table renders.
- `useSearchInstruments(query, type?)` — `GET /api/instruments`; disabled until `query` is non-empty.
- `useAddSymbol()` — `POST /api/symbols` (`periods` omitted falls back to the server's default periods).
- `useUpdatePeriods()` — `PATCH /api/symbols/:id`.
- `useRemoveSymbol()` — `DELETE /api/symbols/:id`.

All go through the package's `apiFetch` wrapper, so logging + `ApiError` mapping happen at the boundary, not at each call site.

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
  The settings page's contract is pinned by `packages/api/tests/e2e/settings-page.e2e.test.ts` (happy path + the 400 critical failure); the watchlist page's by `watchlist-page.e2e.test.ts` (the discover → add → enriched-list → edit → remove round-trip + the 404 failure).
  No browser harness — page-level behaviour is covered by the unit tier.
