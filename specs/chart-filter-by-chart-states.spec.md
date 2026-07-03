# Spec: chart event markers filtered by profile chartStates

- Status: implemented
- Touches:
  - `engine` — `RuleService.listSymbolEvents` accepts an optional `chartStates` filter; applied in the existing in-memory read pipeline (`paginate`) alongside `from` / `to` / `before`.
    The `EventLog` port + adapters + contract are unchanged (windowing already lives at this seam, not in the port).
  - `api` — a dedicated `SymbolRuleEventsQuerySchema` adds an optional `chartStates` query param (JSON-encoded string) on `GET /symbols/:id/rule-events`; the controller parses it into `string[] | undefined` and threads it through.
  - `web` — `useRuleEventsForRange(symbolId, from, to, chartStates)` and `symbolRuleEventsRangeKey(...)` carry the active profile's `chartStates`; `buildEventMarkers(entries)` drops its per-type visibility gate; the `EventMarkersPickerDialog` is deleted.

## Goal

Render chart event markers for only the state keys the active profile lists in `chartStates`, and delete the now-obsolete Event-markers selection modal.
The chart's windowed marker read filters server-side; the live stream inherits the filter for free (it already invalidates → refetches that read).

## Settled decisions

- **Seam** — the filter lives in the application-layer read pipeline (`RuleService.paginate`), the same place the `from` / `to` / `before` window already applies.
  The `EventLog` port stays narrow (it returns the full log); pushing the filter into the port would mean extending both adapters + the shared contract for no gain.
- **Wire encoding** — `chartStates` is a single JSON-encoded array string, not a repeated query param.
  Repeated params cannot distinguish an **empty** array (present, filter to nothing) from an **absent** one (unfiltered) — a distinction this feature requires — so a JSON string is the smallest encoding that carries all three states.
  The controller parses + validates it (malformed ⇒ 400), so the boundary stays checkable.
- **Param-gated** — only the chart's windowed query sends `chartStates`.
  The Events list dialog + count badge send no filter and stay unfiltered.

## Acceptance criteria

Each bullet maps to exactly one test.

### `engine` — `RuleService.listSymbolEvents` server-side filter

- [ ] `listSymbolEvents(symbolId, { chartStates: ['trend'] })` returns only `stateSet` / `stateRemoved` entries whose `key` is `'trend'`, dropping other event types and non-matching state keys (full-payload `toEqual`).
- [ ] `listSymbolEvents(symbolId, { chartStates: [] })` returns `[]`.
- [ ] `listSymbolEvents(symbolId, {})` (no `chartStates`) returns every entry, unfiltered (full-payload `toEqual`).

### `api` — query param + controller

- [ ] `GET /symbols/:id/rule-events?chartStates=["trend"]` returns only the matching state entries (200 + filtered array).
- [ ] `GET /symbols/:id/rule-events?chartStates=not-json` returns 400 with the validation envelope.

### `web` — marker query threads `chartStates`

- [ ] `useRuleEventsForRange(symbolId, from, to, ['trend'])` issues `GET /symbols/:id/rule-events?from=&to=&limit=500&chartStates=["trend"]`.
- [ ] `symbolRuleEventsRangeKey(symbolId, from, to, chartStates)` includes `chartStates` in the returned key (so a profile switch refetches).

### `web` — `buildEventMarkers` without a type gate

- [ ] `buildEventMarkers([])` returns `[]`.
- [ ] `buildEventMarkers([fired, stateSet, error])` returns one marker per entry with the settled shape/color/position/text — no per-type gate (full-payload `toEqual`).
- [ ] `buildEventMarkers` returns markers sorted ascending by `time`.

### Modal removal (verified by the gate, not a unit test)

- [ ] `event-markers-picker-dialog.tsx` + its test are deleted and no reference remains on the chart page (`npm run check:full` green; grep clean).

## End-to-end expectation

`packages/api/tests/e2e/chart-rule-event-markers.e2e.test.ts` (Mongo via testcontainers — CI-only):

1. A watched symbol + a tick-cadence `Price > 100` rule with two `SetSymbolState` actions (keys `fired`, `trend`).
2. Drive one tick (price 101): the fire appends `StateSet(fired)`, `StateSet(trend)`, and the `Fired` umbrella.
3. `GET /symbols/:id/rule-events?from=&to=&chartStates=["trend"]` returns only the `StateSet(trend)` entry — the other key and the `Fired` umbrella are dropped.
4. `GET /symbols/:id/rule-events?from=&to=&chartStates=[]` returns `[]`.

Critical failure mode:

- `GET /symbols/:id/rule-events?chartStates=not-json` returns 400 with the validation envelope.

## Out of scope

- The `EventLog` port / adapters / contract — untouched (the filter is a read-pipeline concern, not a persistence one).
- The Events list dialog (`symbol-rule-events-dialog.tsx`) + count badge (`useSymbolRuleEventsCount`) — they send no filter and stay unfiltered.
- The State-changes overlay dialog — a different feature.
- Any core/domain change — `stateSet` / `stateRemoved` already carry `key`.
- A new live-stream test — the stream already invalidates → refetches the windowed query, so a server-side filter makes it honour the filter with no new code.

## Surprises

(Filled in retroactively if anything bites — empty by default.)
