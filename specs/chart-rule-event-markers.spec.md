# Spec: chart rule-event markers

- Status: draft (marker-visibility control superseded by #475)
- Superseded in part: the per-type `EventMarkersPickerDialog` and `buildEventMarkers`' `visibleTypes` gate were removed in #475.
  Marker visibility is now the active profile's `chartStates`, filtered server-side — see `specs/chart-filter-by-chart-states.spec.md`.
- Touches:
  - `engine` — `RuleService.listEvents` / `listSymbolEvents` accept `from`/`to`; `MongoEventLog.ensureIndexes()` indexes `events.ts`; `ConnectOptions.onRuleEvent` is forwarded from `eventLog.onAppend`.
  - `api` — `RuleEventsQuerySchema` accepts `from`/`to`; new `ruleEventStream: StreamHub<RuleEventEntry>` + `ruleEventSubscriptionKind`; main publishes per-symbol on `onRuleEvent`.
  - `web` — `StreamKind.RuleEvent` + frame routing; `useRuleEventsForRange(symbolId, from, to)` and `useRuleEventStream(symbolId)`; `CandleChart` accepts an `eventMarkers` prop and renders a marker per entry via `createSeriesMarkers`; new `EventMarkersPickerDialog` lives next to the `Events` button on the chart bottom bar.

## Goal

Render rule events as glyph markers on the candle series, scoped to the chart's visible window and ticking live without a refetch.
Users opt out per event type via a checkbox picker that mirrors the Indicators dialog.

## Settled decisions

- **Default-visible event types** — all six (`Fired`, `NotificationSent`, `StateSet`, `StateRemoved`, `Error`, `CycleOverflow`) visible by default; the picker hides individual types.
- **Marker clutter** — render every entry; the per-type picker is the user-controlled escape hatch.
  Tick-cadence rules can stack many entries per bar but `lightweight-charts` merges shapes at the same `time` visually, so a clean glyph still reads.
- **Glyph + color per type** — fixed mapping:
  | Type               | Shape       | Color  | Position    |
  | ------------------ | ----------- | ------ | ----------- |
  | `Fired`            | `circle`    | gray   | `inBar`     |
  | `StateSet`         | `arrowUp`   | green  | `belowBar`  |
  | `StateRemoved`     | `arrowDown` | red    | `aboveBar`  |
  | `NotificationSent` | `square`    | blue   | `aboveBar`  |
  | `Error`            | `circle`    | red    | `aboveBar`  |
  | `CycleOverflow`    | `square`    | amber  | `aboveBar`  |
- **Visibility toggle UX** — a separate `Event markers` button on the chart bottom bar opens a dialog with one checkbox per type (mirrors the Indicators picker dialog).
  **Superseded by #475**: this button + dialog were removed; the active profile's `chartStates` (filtered server-side) is now the single control over which markers render.

## Acceptance criteria

### `RuleService` — windowed event reads

- [ ] `listEvents(id, { from })` returns only entries with `ts >= from` (newest-first, full-payload `toEqual`).
- [ ] `listEvents(id, { to })` returns only entries with `ts < to`.
- [ ] `listEvents(id, { from, to })` returns the half-open `[from, to)` slice, ANDed with the existing `before` cursor when both are supplied.
- [ ] `listSymbolEvents(symbolId, { from, to })` applies the same half-open window on the symbol-mirrored log.

### `MongoEventLog` — index

- [ ] `MongoEventLog.ensureIndexes()` creates a compound index on `watchlist({ _id: 1, 'events.ts': 1 })` (covered by the live tier).

### API — query schema + routes

- [ ] `GET /rules/:id/events?from=&to=` accepts the new params and returns the windowed slice (200 + array body).
- [ ] `GET /symbols/:id/rule-events?from=&to=` accepts the new params and returns the windowed slice.
- [ ] `GET /symbols/:id/rule-events?from=foo` (non-numeric) returns a 400 with the validation envelope.

### Live stream — engine bridge

- [ ] When `ConnectOptions.onRuleEvent` is supplied, an `eventLog.appendSymbolEvent` call invokes it once with the stamped entry and `{ kind: 'symbol', symbolId }`.
- [ ] When `ConnectOptions.onRuleEvent` is supplied, an `eventLog.appendRuleEvent` call invokes it once with `{ kind: 'rule', ruleId }`.

### Live stream — API subscription kind

- [ ] `validateSubscribe({ action: 'subscribe-rule-event', id })` returns `{ input: { id } }`.
- [ ] `validateSubscribe` with a missing `id` returns `{ error }`.
- [ ] `validateUnsubscribe({ action: 'unsubscribe-rule-event', id })` returns `{ key: id }`.
- [ ] `subscribeHub(id, send)` registers on the hub; a subsequent `publish(id, entry)` fans the JSON frame `{ symbolId: id, entry }` to the socket.

### Web — hooks

- [ ] `useRuleEventsForRange(symbolId, from, to)` issues `GET /symbols/:id/rule-events?from=&to=&limit=500` and returns the array.
- [ ] `useRuleEventsForRange` passes `enabled: false` when either bound is `undefined` (no request fires).
- [ ] `useRuleEventStream(symbolId)` subscribes via `streamClient.subscribe(StreamKind.RuleEvent, symbolId, …)` on mount.
- [ ] On an inbound frame the matching `useRuleEventsForRange` query cache is invalidated so the windowed read refetches.
- [ ] `streamClient` routes a `{ symbolId, entry }` frame to the matching `StreamKind.RuleEvent` listener (full-payload `toEqual` on the delivered entry).

### Web — `buildEventMarkers`

- [ ] `buildEventMarkers([], visible)` returns `[]`.
- [ ] `buildEventMarkers([fired, stateSet, error], visible)` returns one marker per entry with the shape/color/position/text from the settled mapping (full-payload `toEqual`).
- [x] ~~Entries whose `type` is hidden in the `visibleTypes` set are dropped from the output.~~ (removed in #475 — the `visibleTypes` gate is gone; the server-side `chartStates` filter decides what reaches the builder.)
- [ ] Markers are returned sorted ascending by `time` (the `lightweight-charts` plugin requires it).

### Web — `CandleChart` wiring

- [ ] When `eventMarkers` is `[]`, the chart attaches no marker plugin for the rule-event series.
- [ ] When `eventMarkers` is non-empty, the chart attaches one plugin via `createSeriesMarkers(candleSeries, …)` and calls it with the mapped list.
- [ ] Replacing the `eventMarkers` prop with a new array calls `setMarkers` again with the new mapped list — no new plugin.

### Web — `EventMarkersPickerDialog` (removed in #475)

Superseded — the dialog was deleted; markers now render per the active profile's `chartStates`.
See `specs/chart-filter-by-chart-states.spec.md`.

- [x] ~~The dialog's trigger button is labeled `Event markers` with a count badge showing how many of the six types are currently visible.~~
- [x] ~~Opening the dialog renders one labeled checkbox per `RuleEventType`, all checked by default.~~
- [x] ~~Unchecking a checkbox removes that `RuleEventType` from the `visible` set the parent owns.~~
- [x] ~~The dialog renders inside the chart bottom bar's `Chart actions` group.~~

## End-to-end expectation

`packages/api/tests/e2e/chart-rule-event-markers.e2e.test.ts`:

1. Spin Mongo via testcontainers; build a watched symbol + a tick-cadence `Price > 100` rule with a `SetSymbolState` action.
2. `GET /symbols/:id/rule-events?from=0&to=Date.now()` returns `[]` (no fires yet).
3. Open `/stream`, send `{ action: 'subscribe-rule-event', id }`.
4. Drive a tick (price 101) through the live quote bridge.
5. Assert the client received `{ symbolId, entry }` frames for the fire (the `Fired` umbrella + `StateSet`).
6. `GET /symbols/:id/rule-events?from=0&to=Date.now()` now returns those entries.

Critical failure mode:

- `GET /symbols/:id/rule-events?from=foo` returns 400 with the validation envelope.

## Out of scope

- Collapsing tick-cadence markers into a per-bar count badge (Q2 alternative).
- Filter by individual rule (Q4 alternative) — the symbol scope is enough.
- Live-cache mutation (the live frame invalidates the windowed query; the next refetch picks up the new entry — one line vs. cache surgery).
- Rule-id-keyed streaming (the chart is symbol-keyed).
- `from`/`to` on the v1 indicator-overlay-marker code path (the rule-event path owns the new descriptor).

## Surprises

(Filled in retroactively if anything bites — empty by default.)
</content>
