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

- **`candle-chart.tsx` owns live application.** It subscribes to the candle feed
  itself (`#41`'s `useStreamSubscription(StreamKind.Candle, symbol.id, …)`) and
  applies **each event imperatively in the callback** — `candleSeriesRef.current
  .update(toCandlestick(candle))` (plus volume) — *not* via React state. A poll
  that crosses an interval boundary emits the just-closed bar's final values and
  the new forming bar as two frames in one batch; collapsing them through a
  single "latest" state value would keep only the last, leaving the closed bar
  stuck at its last in-progress value. Per-event application lets both land —
  `update` replaces the bar when the time matches (forming bar / final
  correction) and appends when it is newer. Each applied bar is also kept in a
  by-time map and re-applied after a `setData` re-seed (theme/data refresh), and
  surfaced as `liveLatest` state to the on-canvas legend header.
- **`liveCandleForPeriod(event, period)`** (`src/lib/hooks/candles.ts`) filters
  the all-periods candle feed to the charted period; the chart skips non-matching
  events. The accumulation resets when the streamed `(id, period)` changes.
- **`useCandleStream(id): CandleEvent | null`** remains the latest-value
  convenience hook; `chart-page.tsx` (`ChartView`) uses it only to drive the tab
  title's latest close (display, where the latest frame suffices).

## Acceptance criteria

Each bullet maps to exactly one test (jsdom; mocked socket / mocked
`lightweight-charts`, mirroring the existing fakes).

- [ ] `useCandleStream(id)` exposes the latest `CandleEvent` and returns `null`
      before any frame; changing `id` unsubscribes the old id and subscribes the
      new one.
- [ ] `liveCandleForPeriod` returns the event's candle when the period matches
      and `null` otherwise.
- [ ] `CandleChart` applies a live event to the series via the `update` mutator
      with the bar's mapped OHLC.
- [ ] `CandleChart` applies **both** a just-closed bar's final values and the
      next forming bar when both arrive from one poll (the close is not dropped) —
      the regression behind stale closed bars.
- [ ] `CandleChart` ignores a live event whose `period` differs from the chart's.
- [ ] `CandleChart` re-applies every accumulated live bar after a `setData`
      re-seed, so a theme/data refresh keeps the live tail.
- [ ] The on-canvas legend header reflects the live bar's close once a tick
      arrives (the latest-candle fallback uses the live bar).
- [ ] Hovering a previous *live* bar shows that bar's OHLC in the legend (the
      inspection lookup checks the accumulated live bars, not just history).
- [ ] `captureViewport` records a `live` bar-count window when the visible range
      reaches the latest bar, and a `fixed` `{from,to}` window when scrolled back.
- [ ] `liveLogicalRange` spans the last `bars` of the series (right edge on the
      newest bar), clamped to bar 0 for short series.
- [ ] `mergeLiveCandle` keeps the bar's open, widens the running high/low, follows
      the latest close, and takes the larger volume; a flat tick stream builds a
      real range rather than a flat line.

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

- **Yahoo's 1m forming bar arrives flat.** Yahoo serves the in-progress 1m bar as
  `O=H=L=C` (just the latest price) until late in the interval, so replacing the
  series bar each tick rendered a flat line. The chart now folds each tick into
  the bar with `mergeLiveCandle` — keeping the open and widening a running
  high/low across ticks — so the forming bar shows a real range even from flat
  inputs. (The backend data-quality root cause — boundary `V=0` bars and the
  flat in-progress bar at source — is tracked separately for a polling refactor;
  see issue #58.)
- **An absolute persisted viewport doesn't follow new bars.** The stored window
  was `{from, to}` epoch-ms and was restored verbatim, so once you were watching
  the live edge the window went stale — new bars appeared off-screen to the right.
  Reworked to a tagged union: `{mode:'live', bars}` (restored in logical/bar-index
  coordinates so the right edge tracks new bars via `shiftVisibleRangeOnNewBar`)
  vs `{mode:'fixed', from, to}` (a pinned historical window). The capture handler
  picks the mode by whether the visible range reaches the latest bar; the decision
  and the restore range are pure helpers (`captureViewport`, `liveLogicalRange`).
- **Live bars aren't in the historical `candles` array.** They're applied to the
  series via `update` and kept in the by-time accumulation, but the legend's
  hovered-candle lookup originally searched only `candles` — so hovering any bar
  that arrived live showed the wrong OHLC (it fell back to the latest), even
  though the bar rendered correctly. The lookup now checks the live bars first.
- **Yahoo's tight poll window returns a zero-volume bar.** A poll resumes from the
  current bar's open; for that window Yahoo reports the in-progress bar with
  `volume: 0` and a degenerate OHLC (so the forming bar looked flat and stored
  candles showed `Vol 0`, while backfilled ones — fetched over a wide window —
  were fine). Fixed in the source by widening an intraday ranged fetch to span a
  few completed bars (see `continuous-polling.spec.md`).
- **A "latest event" state value drops co-arriving frames.** The first design had
  `useCandleStream` keep only the latest event and the chart apply it via an
  effect. When a poll crosses an interval boundary it emits two frames at once —
  the just-closed bar's *final* values and the next *forming* bar — and React
  batches the two state updates, so only the forming bar survived and the closed
  bar kept its last in-progress value (it never received its real close). An
  empirical Yahoo probe confirmed the backend is correct: a tight poll window
  returns the real aligned bar plus a flat `V=0` live row, and the merge folds
  them into a real bar. So the fix is on the client — the chart subscribes itself
  and applies **every** event imperatively in the callback (per frame, immune to
  batching), rather than collapsing to one state value.
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
