# Spec: web chart indicator overlays (historical)

- Status: draft
- Touches: `@lametrader/ui` driving adapter — extends `lib/hooks/indicators.ts` with `useComputeIndicator` (`GET /symbols/:id/indicators/:key`); new `pages/chart/indicators/overlay-palette.ts` (deterministic theme-aware color assignment); new `pages/chart/indicators/indicator-legend.tsx` (per-overlay row with label + crosshair value + show/hide eye + remove); extends `pages/chart/candle-chart.tsx` to mirror an `overlays[]` prop into `lightweight-charts` series (line / markers / separate sub-pane); extends `pages/chart/chart-page.tsx` to assemble the applicable overlays from the selected profile and wire them into the canvas + legend.
  Reuses the existing detach mutation (`useDetachIndicator` + the panel's `AlertDialog` confirm) for the legend's remove.
  No backend change — the compute endpoint already exists.

## Goal

Draw the selected profile's **applicable** indicators on the chart canvas from server-computed historical state, auto-placed by each state field's `pane` / `render` descriptor hint, with a chart-side legend.
Only historical — live updates are a separate task (out of scope).

The single-source-of-truth model stays the same as the panel's: the profile's `indicators[]` (from the cached `useProfiles`) is the list; per applicable instance we issue one `GET /symbols/:id/indicators/:key?period=&<inputs>` and mirror the returned `state` rows into series on the chart.

## Domain / application model

Reuses `@lametrader/core`'s `IndicatorComputeResult`, `IndicatorStatePoint`, `Pane`, `RenderKind`, `StateFieldDescriptor`, plus the existing `IndicatorInstance` (carries `inputs` + the optional `summary` set by the engine) and `IndicatorDefinition` (carries `state[]` descriptors).
No new domain types.

The page derives the **applicable** instances (those whose definition's `appliesTo` includes the chart's `SymbolType`) and feeds them to the canvas + legend; non-applicable instances are skipped (the panel already marks them muted there).

## Mapping descriptors → chart series

For each applicable instance × each of its definition's `state[]` descriptors:

- `FieldType.Number` with `pane: Pane.Overlay` (or `pane` omitted — default overlay) → a `LineSeries` on the price pane.
- `FieldType.Number` with `pane: Pane.Separate` → a `LineSeries` on its own stacked sub-pane (`paneIndex` allocated per separate descriptor, coexisting with the existing volume sub-pane).
- `FieldType.Enum` with `render: RenderKind.Markers` → `series.setMarkers([...])` on the price-pane candlestick series at firing bars (`null` rows skipped).
- Warm-up rows where the descriptor's value is `null` render as gaps (mapped to `lightweight-charts`'s `whitespace` data points, never to `0`).

Each series's `lineColor` (or marker color) comes from `paletteColor(index, theme)` — a deterministic palette indexed by the instance's position in the applicable-sorted-by-id list, with separate palette tables for light / dark themes (the chart already re-creates on theme switch, so series re-colour follows for free).

## `useComputeIndicator` hook

Signature: `useComputeIndicator({ id, key, period, inputs })` → `UseQueryResult<IndicatorComputeResult>`.

- Query key: `['symbol-indicator', id, key, period, inputs]` — a change to any input refetches; the same key across re-renders reuses the cache.
- URL: `GET /symbols/:id/indicators/:key?period=<period>&<inputs serialized as querystring>` — each `inputs` entry becomes a separate query param (the backend's controller spreads the querystring into the inputs map).
- Enabled when `id`, `key`, and `period` are all set; disabled otherwise.

The chart page calls this hook per applicable instance; the result feeds the overlay's series.

## Legend (`indicator-legend.tsx`)

Renders directly below the chart canvas (inside the chart's grid row, above the bottom bar), as a single Radix `Flex` of legend rows — one per applicable instance:

- A 8-px coloured swatch (`paletteColor(index, theme)`) — matches the canvas series.
- The display name (`instance.label ?? definition.name`) and, on the next line, `instance.summary` (the engine-computed short label like `"SMA 14 close"`).
- The crosshair value (the state point at the hovered time; the latest point's `value` when no crosshair is active).
  Number formatted as a fixed-2 string; markers' enum value rendered verbatim.
- A show/hide eye (`lucide Eye` / `EyeOff`) — chart-local view state lifted to the page, mirrored into each series's `applyOptions({ visible })`.
- A remove `x` (`lucide X`) — opens the panel's `DetachIndicatorDialog` confirm flow; on confirm, the existing `useDetachIndicator` mutation runs and the profiles-query invalidation drops the instance from the overlay list automatically.

## Canvas wiring (`candle-chart.tsx`)

A new prop:

```ts
overlays: ReadonlyArray<{
  instanceId: string;
  definition: IndicatorDefinition;
  result: IndicatorComputeResult | null;
  visible: boolean;
  color: string;
}>;
```

The canvas mirrors this into series via a `useEffect`:

- On mount / overlays change: for each overlay × each state descriptor, ensure a series exists (lookup by `instanceId+stateKey`); apply data (mapped from `result.state`); apply visibility; remove any orphan series (instance no longer present).
- On theme/symbol-type recreate (existing effect): all overlay series are torn down along with the candle / volume series; the overlays effect re-creates them with the current theme's palette colours.

## Acceptance criteria

Each bullet maps to exactly one test.

### `lib/hooks/indicators.ts` — `useComputeIndicator`

- [ ] `useComputeIndicator({ id, key, period, inputs })` issues `GET /symbols/:id/indicators/:key?period=<period>&<inputs query string>` and returns the parsed `IndicatorComputeResult` verbatim (full-payload `toEqual`).

### `pages/chart/indicators/overlay-palette.ts`

- [ ] `paletteColor(index, theme)` returns deterministic, theme-distinct values: for `index=0` the light-theme colour differs from the dark-theme colour, and a second call with the same `(index, theme)` returns the same colour (asserted as one snapshot object).

### `pages/chart/candle-chart.tsx` — overlay series wiring (jsdom + mocked `lightweight-charts`)

- [ ] A `Pane.Overlay` numeric overlay creates one `LineSeries` and pushes the state rows as `{ time, value }` line points (warm-up `null`s mapped to whitespace `{ time }` gap entries) — full-payload `toEqual` on the `setData` call argument.
- [ ] A `Pane.Separate` numeric overlay creates a `LineSeries` on its own pane (`paneIndex >= 1`) and pushes the state rows the same way — full-payload `toEqual` on the `addSeries` options and the `setData` call argument.
- [ ] A `RenderKind.Markers` enum overlay calls `setMarkers` on the candlestick series with one marker per firing bar (`null` rows skipped), each carrying `{ time, position, shape, color, text }` derived from the state value — full-payload `toEqual` on the `setMarkers` call argument.
- [ ] Toggling an overlay's `visible` to `false` calls `applyOptions({ visible: false })` on its series; toggling back calls `applyOptions({ visible: true })` — full-payload `toEqual` on the recorded `applyOptions` calls (the overlay-related ones only).
- [ ] Removing an overlay (instance dropped from the prop) removes its series from the chart via `chart.removeSeries` — full-payload `toEqual` on the recorded `removeSeries` calls.

### `pages/chart/indicators/indicator-legend.tsx`

Tests render with `<QueryClientProvider>` + `<Theme>` and fixture overlay rows (no fetch needed — overlays are passed in as props).

- [ ] Renders one row per overlay with the instance's display name, summary, and a coloured swatch whose `style.backgroundColor` matches the overlay's `color` (full-payload of one row's accessible structure).
- [ ] Renders the crosshair value for the hovered time when `hoveredTime` is set — the number is the state row at that time, formatted with two decimals.
- [ ] Renders the latest state value when `hoveredTime` is `null` — the last row's `value`, formatted with two decimals.
- [ ] Clicking the eye toggle fires `onToggleVisible(instanceId)` once with the instance's id (full-payload `toEqual` on the mock's calls).
- [ ] Clicking the remove `x` opens an `AlertDialog`; clicking Detach there issues `DELETE /profiles/:id/indicators/:instanceId` once (full-payload `toEqual` on the captured fetch call).

### `pages/chart/chart-page.tsx` integration

- [ ] When the selected profile has one applicable SMA instance, the page issues `GET /symbols/:id/indicators/sma?period=…&length=14&source=close` exactly once and the canvas receives one overlay with the returned `result` (full-payload of the captured fetch URLs + the overlay prop snapshot).
- [ ] An instance whose definition's `appliesTo` excludes the chart's `SymbolType` does not appear in the overlays (the page issues no compute call for it) — asserted as an empty list of captured compute URLs after the page renders for a `fx` symbol with a crypto-only instance.

## End-to-end expectation

Per the chart-page spec's convention, page-level behaviour for the web package is covered by the jsdom component tier (no browser e2e harness).
The existing `packages/ui/tests/e2e/build.e2e.test.ts` is the only `*.e2e.test.ts` for the package; it asserts `vite build` produces an artifact whose JS bundle contains rendered marker strings.

For this feature, the e2e tier adds **one bundle-marker assertion**: the built JS bundle contains the static copy `"Hide overlay"` (the legend's eye-toggle accessible name), confirming the indicator-overlay module is wired into the live route tree and ships with the deployable artifact.
The build is shared with the existing markers via the same `beforeAll`.

Critical failure mode: the compute endpoint failing for one instance (`500` from `GET /symbols/:id/indicators/:key`) — the chart and the other overlays still render; the failing overlay's legend row shows an `"unavailable"` placeholder in place of its crosshair value, and the canvas creates no series for it (so a stray failure doesn't break the rest of the page).
Asserted in the chart-page jsdom test by responding `500` for one of two configured instances.

## Out of scope

- **Live overlay updates** (`subscribe-indicator`) — the next task; this feature draws the historical compute result once and re-seeds on symbol / period / inputs change only.
- Custom per-overlay color picker — the deterministic palette is enough for now; manual color customization lands later if needed.
- Surfacing the indicator's `summary` in the chart's top-left overlay (`ChartOverlay`) — a one-line follow-up, not required by issue #43.
- Re-rendering or re-seeding existing series on a theme switch via path other than the existing chart-recreate effect — the canvas already tears down on theme change, so we ride that.
- A standalone "indicators" page or any panel-side change — the panel ships as #40 and is untouched here.

## Follow-up additions (post-review polish, same PR)

- **Legend moves into the top-left overlay** — instead of a separate strip below the canvas, the per-overlay rows render directly under the OHLCV stack inside the chart's existing top-left absolute container.
  Reads as one info column ("symbol summary → OHLCV → indicators"), keeps the area below the canvas for the bottom-bar actions only, and removes the page-level `hoveredTime` lift (the legend now lives inside `CandleChart`'s render and reads the canvas's local `hoveredTime` directly).
- **Indicator title removed from the legend row** — each row now reads `[swatch] [summary] [value] [eye] [x]`.
  With every reference indicator declaring a `summary` ("SMA 14 close", "VWMA 20 close ±1/1000 both"), the indicator's full name was duplicative.
  The row's accessible name is the summary string; when no summary is set (a future indicator without one), the indicator definition's `name` is the fallback.

## Surprises

(filled in retroactively)
