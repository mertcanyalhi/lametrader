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

Each visible row ticks live: on mount it subscribes to the symbol's quote feed over the shared `/stream` socket and updates its price/change/change-% in place, with the price cell flashing green (up) or red (down) on each move (suppressed under `prefers-reduced-motion`).
Leaving the page tears the subscriptions down; returning re-subscribes from the current snapshot.
If the socket drops, the shared client reconnects with backoff and replays the active subscriptions, and the watchlist refetches its snapshot so the rows resync.

### `/chart` — Chart

A candlestick chart of one watched symbol on one timeframe, rendered with `lightweight-charts`.
The symbol and period live in the URL (`/chart?id=&period=&range=`), so a chart is shareable and the browser's back/forward buttons navigate between views; a bare `/chart` opens the first watched symbol on your last-selected period (falling back to the config default), or sends you to the watchlist when nothing is watched.
A top-left overlay shows the symbol summary (description · period · exchange) and the inspected candle's open/high/low/close, change, and volume — the candle under the crosshair, or the latest one otherwise.
A bottom action bar holds the profile picker (a single modal that both **selects** the active profile and **manages** them — create / edit / delete from inside the same dialog), the symbol picker (a searchable dialog; instruments outside your watchlist appear faded and can't be charted), the period + date-range dialog, and the **indicator panel** — a dialog labeled `Indicators (N)` (N = the selected profile's attached-instance count) where you attach an indicator from the catalog (descriptor-driven inputs form), edit an existing one's inputs, or detach one (confirmed via `AlertDialog`).
With no profile selected, the indicator panel shows a warning callout pointing back to the profile picker; an attached indicator whose definition's `appliesTo` excludes the current symbol's type renders muted with an "n/a for `<type>`" note (it stays attached on the profile — it just can't compute on this symbol).
The selected profile is per-user state persisted to `localStorage` (`lametrader.selectedProfileId`), not URL state — sharing a chart link does not share a profile.
First-run defaulting picks the first enabled profile when nothing is stored; a stored id missing from `GET /profiles` is treated as "No profile" and is not proactively wiped (so a profile re-created elsewhere re-binds).
Crypto and equities get a volume sub-pane; FX (no volume) omits it.
Candle and volume colors follow the app theme and update live when you toggle it.
Scrolling back in time loads older history a window at a time until the start of what's stored; a symbol with no stored candles shows a "Run backfill" card that fetches history without leaving the page.
The visible date range and selected period persist (localStorage), so switching symbols and reloads keep your view.

The chart ticks live: it subscribes to the symbol's candle feed over the shared `/stream` socket and applies each candle for the charted period to the series in place — updating the forming bar when the time matches, appending when it's newer — so the latest bar (and the overlay's price header / document title) track the stream. Changing symbol or period re-subscribes; leaving the page tears the subscription down.

The selected profile's **applicable** indicator instances (those whose definition's `appliesTo` covers the chart's symbol type) render directly on the canvas: numeric state fields with `Pane.Overlay` draw as price-pane lines, `Pane.Separate` draws into a stacked sub-pane (coexisting with the volume pane), and enum state fields with `RenderKind.Markers` draw as price-pane markers at firing bars (`null` rows render as gaps).
Each applicable instance gets a deterministic palette colour, fetched once per `(symbol, period, inputs)` via `GET /symbols/:id/indicators/:key`.
A legend below the canvas lists every overlay with its display name + summary, the value at the crosshair (or the latest non-null when no crosshair), a show/hide eye (chart-local view state), and a remove `x` that opens the same `AlertDialog` detach confirm the panel uses.
Live updates land in a follow-up issue.

The bottom action bar also carries a **`Rules N`** button (label includes the live count of rules in the current profile scoped to the current symbol; refetched on either change).
Clicking opens a dialog containing the same rules table the `/rules` page uses, filtered to the current symbol — Edit a row to open the editor in `edit` mode, or **`+ New rule`** to open it in `create` mode with the profile + symbol pre-filled.

Symbol activity also lands on the chart itself: every `state_set` rule event renders a circle marker below the matching bar (via a single marker plugin attached to the candle series), and a collapsible **Events** panel under the canvas lists the symbol's events newest-first with **Load more** pagination (`GET /symbols/:id/rule-events`). The panel's open / closed state persists to `localStorage` so reloads remember it.

### `/rules` — Rules

A profile-scoped list of rules with full CRUD.
The bottom-bar profile picker is the same `ProfilePickerDialog` as the chart, so the active profile and its persistence are shared.
The list body only mounts once a profile is selected, keeping `useRules({ profileId })` cleanly conditional.

The table columns are `Order`, `Name`, `Scope`, `Trigger`, `Last fired`, `Actions`.
Per row affordances:

- **Enable / disable** — an inline `Switch` on the name cell that calls `PATCH /rules/:id { enabled }` with an optimistic write across every cached rules query (rolls back on error; invalidates on settled).
- **Move up / down** — Chevron `IconButton`s that emit a single `PUT /rules/order { ids }` per click via `useReorderRules`. Up on the top row and Down on the bottom row are `disabled`.
- **Edit** — opens `<RuleEditorDialog>` in `edit` mode with the row's rule.
- **Events** — opens `<EventsDialog>` in `rule` mode (`GET /rules/:id/events`, "Load more" via `useInfiniteQuery`).
- **Delete** — opens a confirmation `AlertDialog`; on confirm fires `DELETE /rules/:id` with the same snapshot-rollback pattern (`useDeleteRule`).

`<RuleEditorDialog>` is the shared editor for both `create` (used from the chart's Rules dialog) and `edit` (used here): a Radix `Dialog` with a `react-hook-form` / Yup-validated form covering name, description, scope (symbol picker scoped to the current profile or all-symbols), enabled, the recursive condition tree (AND/OR groups + leaves with operand + operator pickers wired to core's `validateOperatorOperands`), trigger (`Once` / `OncePerBar` / `OncePerBarClose` / `OncePerMinute` with per-variant inputs), expiration (`Never` or `On date` — future-dated only), and the actions list (`SetSymbolState` / `RemoveSymbolState` / `SetGlobalState` / `RemoveGlobalState` / `NotifyTelegram` with a destination dropdown sourced from `/notification/telegram/destinations`).
Cancel closes without persisting; Save calls `useCreateRule` / `useReplaceRule`; a server-rejected save (400, including `TemplateError` on NotifyTelegram) surfaces inline as a red `Callout`.

### `/rules-v2` — Rules v2 (preview, feature-flag-gated)

The v2 rule editor, mounted behind the rules-v2 feature flag (default off — the route + sidebar entry are absent unless the flag is enabled). Coexists with the v1 `/rules` page during the rebuild per ADR 0016; the hard cutover lands when the engine work completes.

Enable the flag for a session via the URL query `?rulesV2=1`, or persist it across sessions with `localStorage.setItem('rulesV2Enabled', 'true')`. The URL param wins over `localStorage`, so a shared link always opens the v2 surface even on a browser where the flag has never been flipped (handy for sharing a test link).

The editor surface mirrors the v1 layout: a Radix `Dialog` with `react-hook-form` / Yup-validated sections for name + description, scope (`Symbol` / `Symbols(list)` / `AllSymbols`), trigger (the six `TriggerKind`s with per-kind `period` / `intervalMs` fields), the recursive condition tree, and the actions list (`Notification` Telegram + the four state-mutation actions).

The condition-tree leaf editor walks the leaf `family` to pick the row layout:

- **Comparison / Crossing / State** — LHS operand + operator + RHS operand. The `Interval` row appears when any operand needs a bar period (OHLCV / IndicatorRef).
- **Channel** — LHS + Lower + Upper bound pickers (full operands).
- **Moving** — LHS + numeric `threshold` + integer `bars`, no RHS picker (the scalar tuple is on the operator).

The 10 operand kinds from CONTEXT.md render labelled `Price` (replaces v1's `Current`), `Open` / `High` / `Low` / `Close` / `Volume`, `Indicator` (instance + state-field picker), `Symbol state` / `Global state` (state-key dropdown seeded from `/state/global` and `/symbols/:id/state`, with a freetext fallback), and `Value` (Literal, typed by the resolved LHS `valueType` — numeric → numeric stepper, bool → switch, string / enum → text input).

When the LHS resolves to a Bool-typed operand (a state-key or indicator state), the editor collapses to a single-operand row (operator + RHS hidden); the leaf persists as `State / Equals` against `Literal(true)`.

API field-level validation errors (`{ error, fields[] }` from `/v2/rules` per #395) surface inline next to the offending section.

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

**Telegram destinations**

A second Card on the same page manages the API's named Telegram destinations (`GET / POST / DELETE /api/config/notifications/telegram` — see the API README's `Notification destinations` section).
The table shows `Name` and `Chat id` only — bot tokens stay server-side; the API never reads them back.
**Add destination** opens a Radix `Dialog` with a Yup-validated form (every field required, non-blank; bot token rendered as `type="password"`).
A per-row Delete affordance opens a Radix `AlertDialog` confirm before firing `DELETE /api/config/notifications/telegram/:name`.

The same `/settings` page is the home for every future notification adapter — add a sibling component alongside `TelegramDestinationsSection` when one lands.

## Hooks

`src/lib/hooks/use-config.ts` exposes:

- `useConfig()` — `GET /api/config` via TanStack Query under key `['config']`.
- `useUpdateConfig()` — `PUT /api/config`; on success, writes the response straight into the `['config']` cache so any subscriber re-renders without a follow-up round-trip.

`src/lib/hooks/symbols.ts` exposes the watchlist data layer (read the watched symbols, search instruments, add/edit-periods/remove).

`src/lib/hooks/profiles.ts` exposes the profile data layer for the chart's profile picker — `useProfiles` (`GET /profiles`), `useCreateProfile` (`POST`), `useUpdateProfile` (`PATCH /profiles/:id` — only `name/description/enabled`, so the server preserves `scope` and `indicators`), and `useDeleteProfile` (`DELETE`).
The global selection lives in `src/lib/selected-profile-context.tsx` (Context + Provider, mounted at the app shell) and is persisted via `src/lib/selected-profile.ts` (the only module that touches `localStorage` for this concern).

`src/lib/hooks/indicators.ts` exposes the indicator-management surface used by the chart's indicator panel — `useIndicatorCatalog` (`GET /indicators`), `useAttachIndicator(profileId)` (`POST /profiles/:id/indicators`), `useUpdateIndicator(profileId)` (`PUT /profiles/:id/indicators/:instanceId`, full-replace), and `useDetachIndicator(profileId)` (`DELETE /profiles/:id/indicators/:instanceId`), plus `useComputeIndicator({ id, key, period, inputs, from?, to? })` for the chart-overlay compute call (`GET /symbols/:id/indicators/:key?period=&from=&to=&<inputs>`) — exported alongside `computeIndicatorQueryOptions` so the chart page can drive an array of these through `useQueries` (one per applicable instance).
The chart page sets `from` / `to` from the loaded candle feed's earliest and latest+1 timestamps; the engine adds the indicator's warm-up margin internally so the returned slice is fully warm without paying for a full-history scan.
The mutations invalidate `['profiles']` so the profile's embedded `indicators[]` array refetches.

`src/lib/hooks/candles.ts` exposes `usePagedCandles` — the chart's historical candle feed, which loads a symbol/period's bars a time window at a time and walks the window backward through history as you scroll.

`src/lib/hooks/rules.ts` exposes the rules data layer — `useRules({ profileId?, symbolId? })` (`GET /rules`), `useRule(id)` (`GET /rules/:id`), `useCreateRule` (`POST /rules`), `useReplaceRule` (`PUT /rules/:id`), `usePatchRule` (`PATCH /rules/:id` — currently just `enabled`; performs an optimistic write across every cached rules query, rolls back on error), `useDeleteRule` (`DELETE /rules/:id`; same snapshot rollback pattern), `useReorderRules` (`PUT /rules/order`), `useRuleEvents(id, { limit?, before? })` (`GET /rules/:id/events`), and `useSymbolRuleEvents(symbolId, { limit?, before? })` (`GET /symbols/:id/rule-events`).
The chart's Events panel and the per-rule / per-symbol `EventsDialog` build on top of these via `useInfiniteQuery` for "Load more" pagination keyed by the oldest event's `ts`.

`src/lib/hooks/rules-v2.ts` is the v2-shaped equivalent behind the rules-v2 feature flag (mounted under `/api/v2/rules`) — `useRulesV2(filters?)` (`GET /v2/rules?profileId=&symbolId=&enabled=`), `useRuleV2(id)`, `useCreateRuleV2`, `usePatchRuleV2`, `useDeleteRuleV2`, and `useRuleV2Events(id, { limit?, before? })`. The v2 surface coexists with the v1 hooks during the rebuild per ADR 0016; the hard cutover lands when the engine work completes.

`src/lib/hooks/telegram.ts` exposes the notification-destinations data layer behind the rule editor's destination dropdown and the settings page's destinations CRUD — `useTelegramDestinations` (`GET /config/notifications/telegram` → `{ name, chatId }[]`), `useUpsertTelegramDestination` (`POST` upsert; tokens are write-only), and `useDeleteTelegramDestination` (`DELETE /config/notifications/telegram/:name`).
Token reads aren't possible: the API never returns `botToken` on a list, so there's no client-side bot-token handling beyond the Add form.
The matching CRUD CLI surface lives under `lametrader config notifications telegram` (see the CLI README's `config` section).

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
