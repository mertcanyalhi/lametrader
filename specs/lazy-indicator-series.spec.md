# Lazy-paged indicator series

Replace the eager `IndicatorSeriesStore` (full-history `warmup` + per-bar `onBar`, #498 / #503) with a lazy, async paged indicator series that mirrors the bar-series pager (`PagedBarSeriesView`, #505).
An `IndicatorRef` operand resolves through the same async `SeriesView` contract the OHLCV operands already use, backed by a generator that computes indicator points on demand as an operator walks back — bounded above by the firing observation's timestamp.

## Motivation

`PagedBarSeriesView` (#505) turned the OHLCV operand from an eager full-history load into a lazy backward pager over `CandleRepository.latestN`.
The indicator series is still on the old eager pattern: `warmup` computes an instance's entire series at startup and holds it in memory; `onBar` recomputes each arriving bar.
This pays an O(all-history) compute per attached instance at boot and holds the full series in memory — exactly the cost #505 removed for bars.

Indicators are stateful (an SMA point at bar *N* needs the preceding `length` bars), so the lazy generator pages **candles** and computes a **page of indicator points per candle page** via `IndicatorService.compute` over a bounded window — never one recompute per point.
`IndicatorService.compute` already warms a bounded window internally: for `range = { from, to }` it loads the `warmup(inputs)` candles ending just before `from`, prepends them, computes, and slices to `[from, to)`, so every in-page row is fully warmed.

## Design

- `PagedIndicatorSeriesView` implements `SeriesView` (`backwardWalk()`, `asOf()`, no `length`).
  It pages the candle repository newest-first (`latestN(pageSize, cursor)`, `time < cursor`), and for each candle page issues **one** `IndicatorService.compute` call over `{ from: oldestCandle.time, to: newestCandle.time + 1 }`, projecting the requested `stateKey` out of the returned rows and yielding them newest-first.
  It pages further back only when an operator walks past the current page; a short candle page ends the walk.
  Bounded above by an exclusive `before` timestamp, exactly like `PagedBarSeriesView`.
- `IndicatorSeriesStore` is reduced to a config registry + view factory: `register(config)` stores an instance's `(indicatorKey, inputs)` by `instanceId` (cheap, no compute); `series(symbolId, period, instanceId, stateKey, before)` builds a lazy `PagedIndicatorSeriesView`, or an empty view when the instance is unregistered.
  Multi-symbol / period isolation is preserved because the firing `symbolId` + `period` are compute arguments, not part of the stored config.
- `registerIndicatorInstances` replaces `warmIndicatorStore`: it enumerates every enabled profile's attached instances and registers each config — no candle load, no symbol/period enumeration, no compute at startup.
- The eager machinery is removed: `warmup`, `onBar`, the bar-bridge `prepare()` indicator recompute (and the `EventBatch.prepare` step), and the O(all-history) startup warm-up.

## Acceptance criteria

### `PagedIndicatorSeriesView`

- `backwardWalk` yields the same points (newest-first) an eager full-series `IndicatorService.compute` produces over the same bars — parity, full-payload.
- `asOf(queryTs)` returns the latest point with `ts <= queryTs`, or `null` when none qualify.
- A candle stored at or after the exclusive `before` bound never becomes a yielded point (no future bar leaks in).
- A full walk over N indicator points with page size P issues `ceil(N / P)` compute calls, not N — the rolling-window recompute is bounded per page, not per point.
- A compute failure (asset-class mismatch / invalid inputs / unwatched symbol) ends the walk with no points rather than throwing.

### `IndicatorSeriesStore`

- `series` for a registered instance resolves to a lazy view whose latest (`asOf(MAX)`) matches the SMA over the seeded bars for that symbol + period.
- `series` for an unregistered instance returns an empty view (no data yet, not a crash).
- Two symbols sharing one `instanceId` resolve independent series — `series(BTC, …)` reads BTC's candles, `series(ETH, …)` reads ETH's (compound-key isolation, #498).
- `series` is bounded above by `before`: a bar stored at/after `before` is excluded from the resolved latest.

### `registerIndicatorInstances`

- Registers each enabled profile's attached instances so an `IndicatorRef` operand resolves through the store's lazy view.
- Does not register a disabled profile's instances — its `series` stays empty.

### Evaluation context

- `resolveLatest` / `resolvePrev` / `resolveSeries` for `OperandKind.IndicatorRef` resolve through the store's lazy view, bounded by the context's `before`.
- An `IndicatorRef` with no interval resolves to `null` (no period to key on), unchanged from before.

### End-to-end (existing)

- `indicator-operand-fire.e2e-spec.ts` still fires when a live bar lifts the SMA above the literal and does not fire when it stays below — now driven by the lazy view instead of `warmup` + `onBar`.
