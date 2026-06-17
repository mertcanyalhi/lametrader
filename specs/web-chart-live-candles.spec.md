# Spec: web chart live candle ticks — update the forming bar (#42)

- Status: implemented
- Touches: `web` only, building on the shared `/stream` client from `#41`.
  New `useCandleStream(id)` in `src/lib/hooks/candles.ts` over the shared client.
  `candle-chart.tsx` applies live `CandleEvent`s to the series (forming-bar
  update / append) and keeps its on-canvas price header live.
  `chart-page.tsx` filters the stream to the active period and threads the live
  bar down.
  Backend untouched — `/stream`'s candle feed already exists.

## Goal

Make the chart tick live: subscribe to the `/stream` candle feed for the active
`(symbol, period)` and update the chart's forming bar — and the on-canvas price
header — in real time.

## Background

`#41` landed the shared connection manager and `useStreamSubscription`.
This task adds the **candle** consumer over the same socket (no second socket):
the client sends `{ action: 'subscribe', id }` and the server forwards each
`CandleEvent` (`{ id, period, candle, final }`) for that id, across **all** the
symbol's polled periods — so the consumer filters to the chart's chosen period.

The web's `CandleEvent` transport type already exists from `#41`
(`src/lib/stream/stream-client.types.ts`), mirroring the engine's shape over
`core`'s `Candle` / `Period` (the engine is Node-only and not importable here).

`lightweight-charts`' `ISeriesApi.update(point)` is the forming-bar primitive:
given a point whose time equals the last bar's it replaces that bar in place,
and given a newer time it appends — exactly the "update or append" behaviour
required, so the chart calls `update(...)` per tick rather than re-`setData`ing.

## Design

- **`useCandleStream(id): CandleEvent | null`** (`src/lib/hooks/candles.ts`) —
  built on `#41`'s `useStreamSubscription(StreamKind.Candle, id, …)`; returns the
  latest candle event for the id (or `null` before the first), re-subscribing on
  `id` change and tearing down on unmount.
- **`chart-page.tsx` (`ChartView`)** filters the live event to the charted
  period (`event.period === period`) and passes the resulting `Candle | null`
  down to `CandleChart` as a `liveCandle` prop; it also feeds that live bar into
  the latest candle the `DocumentTitle` reads, so the tab tracks the live close.
- **`candle-chart.tsx`** gains a `liveCandle` prop and an effect that, on each
  new live bar, calls `candleSeriesRef.current.update(toCandlestick(liveCandle))`
  (and, when a volume pane exists, `volumeSeriesRef.current.update(toVolume(…))`).
  It also tracks the live bar as state so the **on-canvas legend header** (the
  latest-candle fallback when nothing is hovered) shows the live OHLC/close,
  colored green/red — the chart's live "price header".
- Subscription lifecycle: `useCandleStream(id)` re-subscribes when the symbol id
  changes and tears down on unmount; the period filter handles period switches
  (the same id keeps one upstream candle subscription, frames filtered
  client-side).

## Acceptance criteria

Each bullet maps to exactly one test (jsdom; mocked socket / mocked
`lightweight-charts`, mirroring the existing fakes).

- [ ] `useCandleStream(id)` exposes the latest `CandleEvent` and returns `null`
      before any frame; changing `id` unsubscribes the old id and subscribes the
      new one.
- [ ] A live `Candle` whose `time` equals the last loaded bar's makes
      `CandleChart` call the series' `update` mutator with that bar's mapped
      OHLC (forming-bar update in place).
- [ ] A live `Candle` with a newer `time` than the last bar makes `CandleChart`
      call `update` with the new mapped bar (append).
- [ ] `ChartView` passes a live candle to the chart only when the event's
      `period` matches the charted period (a mismatched-period event yields
      `null` to the chart).
- [ ] The on-canvas legend header reflects the live bar's close once a tick
      arrives (the latest-candle fallback uses the live bar).

## End-to-end expectation

The server candle `/stream` path already has its API e2e
(`packages/api/tests/e2e/polling.e2e.test.ts`).
The browser-side e2e is the web build (`packages/web/tests/e2e/build.e2e.test.ts`)
staying green with the live-chart code compiled in.
The end-user happy path — the forming bar moving on a streamed candle — is
asserted by the jsdom component tests above (mocked socket + mocked chart),
the realistic surface for a canvas feature.

## Out of scope

- The static chart (`#38`) and the shared client itself (`#41`).
- Indicator overlays (their own tasks).
- Reconciling a missed window on reconnect for the chart (the candle feed is
  live-only; a full resync is a page reload / navigation).

## Surprises

- **The historical `candles` array identity must be stable.** `usePagedCandles`
  rebuilt the flattened array on every render, so each live tick (which
  re-renders the chart page) handed the chart a new `candles` reference,
  re-running the data effect's `setData` — which wipes the bars applied via
  `update` and then re-seeds only from history. The result: every new minute's
  bar replaced the previous one (so closed bars vanished) and the load-time bar
  reverted to its partial value. Fixed by memoizing `candles` on the query pages,
  and by accumulating *all* live bars (not just the latest) to re-apply after any
  genuine `setData` (theme/data refresh), keyed reset on `(id, period)`.
- **`setData` drops the forming bar.** Live ticks live only via `series.update`,
  but the data effect's `setData` (on a candles refetch / theme change) replaces
  the whole series, erasing the live bar until the next tick. The fix keeps the
  current live bar in a ref and re-applies it with `update` at the end of the
  data effect, so a refresh doesn't blink the forming bar away.
- **No `chart-toolbar.tsx` to update.** The issue named a toolbar header, but the
  static chart surfaces the latest close through the on-canvas `CandleLegend`
  (latest-candle fallback) and the document title. Threading the live bar into
  the legend's latest-candle fallback (and the title's `latest`) makes both track
  the stream — no new toolbar component.
- **Mocking `lightweight-charts`.** The chart distinguishes its candlestick vs
  volume series purely by `addSeries` call order, so the test's mock records
  series in creation order (`[0]` = candlestick) and asserts `update` on `[0]`.
- **jsdom has no `WebSocket`.** `chart-page.test.tsx` now renders `ChartView`,
  which subscribes via `useCandleStream`, so it mocks the shared stream client
  (as `watchlist-page.test.tsx` does) to avoid constructing a real socket.
