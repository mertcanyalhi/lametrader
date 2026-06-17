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

The original inline toolbar (symbol `Select`, period buttons, snapshot header on top) was reshaped into a TradingView-style layout in v1.1 — see *Refinements (v1.1)* below.
The URL contract is preserved: `?id=…` for the symbol and `?period=…` for the period (now plus `?range=…`).
The disabled-period and snapshot behaviours moved into the modal and the canvas overlay respectively.

### Page states

- [ ] Bare `/chart` (no `id`) redirects to the first watched symbol with `config.defaultPeriod`.
- [ ] Bare `/chart` with an empty watchlist redirects to `/`.
- [ ] When the selected symbol has loaded zero candles, the page shows an explicit empty state with a "Run backfill" action that opens the backfill flow.
- [ ] When the URL's `period` is not among the symbol's watched periods, the page shows a "period not watched — edit on the watchlist" hint instead of the chart.

### Refinements (v1.1)

#### Decimal-aware price formatting

- [ ] `formatPrice` shows enough decimals to keep ~4 significant figures across magnitudes (e.g. `50000 → "50,000.00"`, `123.3 → "123.30"`, `0.5432 → "0.5432"`, `0.000034 → "0.0000340"`).
  The shared helper is the single source of truth; the watchlist and chart both inherit it.

#### Volume formatting

- [ ] `formatVolume` renders human-readable magnitudes with `K`/`M`/`B` suffixes (e.g. `258_270 → "258.27K"`, `12_300_000 → "12.30M"`).

#### Top-left chart overlay (summary + legend)

- [ ] A top-left overlay is rendered *inside the chart pane* (TradingView style): the symbol's `description · period · exchange` on top, the inspected candle's OHLC + diff + volume below it.
  The summary line is always present once a symbol is selected; the OHLC legend appears once candles load.

#### Dynamic document title

- [ ] `document.title` reflects the current symbol + snapshot quote (`<symbol> · <price> <change> (<pct>%) — lametrader`); resets when the page unmounts.

#### Candle-inspection legend

- [ ] A top-left overlay on the chart shows the hovered candle's OHLC + diff + volume (e.g. `O 123.02  H 124.49  L 122.00  C 123.30  +0.25 (+0.20%)  Vol 258.27K`); when no candle is hovered, the latest candle's values are shown.
  OHLC + diff are colored green when the candle's close ≥ open and red when close < open; the volume label is neutral.
  FX (no volume) omits the `Vol` segment.

#### Symbol-picker modal (replaces the dropdown)

- [ ] The symbol selector is a modal trigger button showing the current symbol id; clicking opens a dialog listing the watched symbols plus a search input.
- [ ] Search results outside the watchlist render faded; clicking a non-watched result shows a popover saying "Symbol is not in the watchlist" (info only) and does not change the URL.
- [ ] Clicking a watched result closes the dialog and updates the URL `?id=…&period=<current>`.

#### Period + range modal (replaces the inline period bar)

- [ ] The period selector is a modal trigger button showing the current period (and range when set); clicking opens a dialog with two sections — range presets (`1D 5D 1M 3M 6M YTD 1Y 5Y All`) and the symbol's watched periods.
- [ ] Confirming the dialog writes `?period=…&range=…` to the URL; the chart's visible time scale is set to `[now − rangeMillis(range), now]`, and the existing windowed scroll-back keeps working — `loadOlder()` auto-runs to fill the visible range, and the user can still scroll further back beyond the preset.
- [ ] Periods the symbol is not watched on are disabled in the dialog.

#### Bottom action bar

- [ ] Below the chart pane, a thin action bar holds the symbol-picker trigger and the period+range trigger (extensible for future actions per the screenshot reference).

#### Watchlist → chart navigation

- [ ] On the watchlist page, each row's symbol id is a link to `/chart?id=<id>&period=<defaultPeriod>`, opening that symbol on the platform's default period.

#### Persisted visible window

- [ ] The chart's visible time window (set by scroll/pinch) is persisted to `localStorage` (`getStoredViewport`/`setStoredViewport` round-trip; malformed/absent values yield `null`).
- [ ] Switching symbols (and reloading) restores the persisted window: the new symbol opens on the same start/end timestamps, paging older history in first if the window starts before the loaded data.
  Capture is gated until the restore settles so the chart's initial auto-fit can't overwrite the stored window; a preset range, when set, owns the view instead.

#### Persisted period

- [ ] The selected period is persisted to `localStorage` (`getStoredPeriod`/`setStoredPeriod`; non-period values yield `null`) when applied from the period dialog.
- [ ] A bare `/chart` (or reload) opens on the last-selected period when it's still enabled in config, otherwise the config default.

#### Document title

- [ ] The document title reflects the chart's latest loaded candle on the current period — `<id> · <close> <Δ vs prev close> (<pct>%) - lametrader` — not the default-period snapshot; it falls back to `<id>` (or `<id> · <price>`) with fewer than two candles.

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

### v1.1 refinement surprises

- `formatPrice` can't render *consistent* decimal alignment across an instrument's candles without per-asset precision metadata (FX wants 4–5 dp, equities 2, crypto varies).
  v1.1 uses a magnitude-aware range (`min=2`, `max ∈ [2, 8]` based on the value) and Intl trims to the value's own precision — so a single FX candle with `H=1.0823, L=1.078` renders as "1.0823" / "1.078" rather than "1.0823" / "1.0780".
  Polishing this needs an instrument-precision field from the API; tracked as a follow-up.
- `aria-label` on a bare `<div>` is rejected by Biome's a11y rules (no role to support the attribute) and `role="group"` is rejected by `useSemanticElements` (which wants `<fieldset>`).
  The candle legend and the original snapshot header both use a native `<output>` element — it's semantically a result/status, accepts `aria-label`, and trips neither rule.
- The candle "selected" by the legend is the crosshair-hovered one (`lightweight-charts`' `subscribeCrosshairMove`); when no crosshair is active the latest candle stands in as a stable default. Click-to-select isn't an idiom for this library.
- Range presets cooperate with — rather than replace — the windowed scroll-back: picking "1Y" pins the visible time scale to `[now − 1y, now]` and the chart's range-fill effect auto-runs `loadOlder()` until the earliest loaded candle covers the range; scroll-back beyond the preset keeps working.
