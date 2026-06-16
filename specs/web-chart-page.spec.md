# Spec: web chart page (static)

- Status: implemented
- Touches: `@lametrader/web` driving adapter (new `/chart` page + `usePagedCandles` hook); reads the existing `GET /symbols/:id/candles`, `GET /symbols?enrich=true`, `GET /config` REST surfaces.
  No backend change.

## Goal

Build the `/chart` page: pick a watched symbol + period from a toolbar and render a TradingView-style candlestick chart (`lightweight-charts`) from historical candles, with a volume sub-pane for asset classes that have volume.
Symbol/period live in the URL so navigation is shareable and back/forward works.
Live candle ticks and indicators are separate tasks.

## Pagination model (resolved)

`GET /symbols/:id/candles?period=&from=&to=&limit=` paginates **forward only** (ascending by time; `nextCursor` walks toward *newer* bars), so it cannot fetch bars *before* a cursor.
The chart instead loads by **time window** and extends the window backward to reveal history:

- **Initial window** — `[from = anchor − span, to = anchor)` where `anchor = Date.now()` and `span = BARS_PER_PAGE × periodMillis(period)`.
  `span` is sized so the window holds at most `BARS_PER_PAGE` bars, well under `limit`, so the window returns whole (no mid-window truncation).
- **Load older** — when the visible range reaches the earliest loaded bar, fetch `[earliest − span, earliest)` and **prepend**; the backward offset is one view span, repeated.
- **Stop** — when an older window returns no candles (the start of the contiguous backfilled history); `hasMore` becomes `false`.

This deliberately anchors the newest edge at wall-clock `now`; a symbol whose latest stored candle predates the initial window opens empty (see Out of scope) — acceptable for the static milestone, since freshness arrives with live ticking.

## Acceptance criteria

Each bullet maps to exactly one test.

### `usePagedCandles` hook

- [ ] Loads the initial window on mount: issues `GET /symbols/:id/candles` with `period`, `to = now`, `from = now − BARS_PER_PAGE×periodMillis`, and `limit`, and exposes the returned candles ascending.
- [ ] `loadOlder()` fetches the next older window (`to = earliest loaded time`, `from = earliest − span`) and prepends its candles to the accumulated series.
- [ ] Sets `hasMore` to `false` when an older window returns an empty page (start of history reached), and a further `loadOlder()` issues no request.
- [ ] Resets and reloads from scratch when `period` changes (a new period is a new series, not appended to the old one).

### Pure helpers

- [ ] `showsVolume(type)` is `true` for crypto, stock, and fund; `false` for fx.
- [ ] `chartColors(theme)` returns distinct up/down (and background/text) colors for dark vs light.

### Toolbar + URL contract

- [ ] Selecting a different symbol updates the URL to `/chart?id=<new>&period=<current>`.
- [ ] Selecting a different period updates the URL to `/chart?id=<current>&period=<new>`.
- [ ] A period the symbol does not watch is disabled in the toolbar with a Radix `Tooltip` hint (no `title=`).
- [ ] The toolbar header shows the symbol's snapshot price/change from the enriched watchlist quote.

### Page states

- [ ] Bare `/chart` (no `id`) redirects to the first watched symbol with `config.defaultPeriod`.
- [ ] Bare `/chart` with an empty watchlist redirects to `/`.
- [ ] When the selected symbol has loaded zero candles, the page shows an explicit empty state with a "Run backfill" action that opens the backfill flow.
- [ ] When the URL's `period` is not among the symbol's watched periods, the page shows a "period not watched — edit on the watchlist" hint instead of the chart.

## End-to-end expectation

The chart page's data contract is pinned at the HTTP boundary in `packages/api/tests/e2e/`:
add a symbol → backfill it → `GET /symbols/:id/candles` paginates a window (happy path: a windowed range returns the expected ascending candles and an older window beyond the data returns an empty page).
Critical failure mode: requesting candles for a symbol/period with nothing stored returns an empty page (`{ candles: [], nextCursor: null }`), which the UI renders as the "Run backfill" empty state — not an error.

Page-level behaviour (URL round-trip, empty-state button, redirect) is covered by the jsdom component tier, per the repo's web convention (no browser e2e harness).

## Out of scope

- Live candle ticks (`/stream` WebSocket) — a separate task.
- Indicator overlays / panel — separate tasks.
- Drawing tools, multi-chart layouts, order entry.
- A "jump to latest" / latest-timestamp discovery endpoint; the initial window anchors on `now`, so a symbol with only stale (pre-window) candles opens empty until backfilled forward.
- Verifying `lightweight-charts` canvas pixels in unit tests; the canvas wrapper is mocked in component tests — only the data/URL/state logic is asserted.

## Surprises

- `lightweight-charts` v5 dropped `addCandlestickSeries`/`addHistogramSeries` in favor of `chart.addSeries(CandlestickSeries, …)` / `addSeries(HistogramSeries, …)` with the series type imported as a value.
- The issue asked for a `ResizeObserver`; `lightweight-charts`' built-in `autoSize: true` is the maintained equivalent (it observes the container itself), so the chart uses that instead of a hand-rolled observer.
- Biome's a11y rules reject `aria-label` on a bare `<div>` (no supporting role) and reject `role="group"` (wants `<fieldset>`).
  The snapshot header is a native `<output>` element — semantically a result/status, accepts `aria-label`, and trips neither rule.
- The disabled-period tooltip wraps the disabled `<button>` in a plain `<span>` (no `tabIndex`, which Biome flags on non-interactive elements); the hover hint reaches mouse users via the span, which is enough for the "not watched" cue.
