# Spec: chart Events button + symbol-scoped rule-events table

- Status: implemented
- Touches: `EventLog` port (driven) — new `countSymbolEvents`; `RuleService` (application) — new `countSymbolEvents`; HTTP adapter `rulesController` — new `GET /symbols/:id/rule-events/count`; web hooks `useSymbolRuleEvents` + `useSymbolRuleEventsCount` (new); `ChartPage` bottom bar (new Events button); new `SymbolRuleEventsDialog` component.

## Goal

On the Charts page expose an Events button next to Rules-style buttons that shows the count of rule events fired for the currently-viewed symbol.
Clicking the button opens a modal containing a paginated, sortable table of those events.
Both timestamps the entry carries (source `ts` and persistence `firedAt`) must be visible and labeled distinctly.

The count is backed by a dedicated endpoint so the badge stays accurate without paging through the rows.
Sort axes cover both `firedAt` (default newest-first) and `ts`.

## Acceptance criteria

Each bullet maps to exactly one test.

### EventLog port (driven)

- [ ] `InMemoryEventLog.countSymbolEvents(symbolId)` returns `0` for an unknown symbol.
- [ ] `InMemoryEventLog.countSymbolEvents(symbolId)` returns the number of mirrored entries appended for that symbol (and ignores other symbols).
- [ ] `MongoEventLog.countSymbolEvents(symbolId)` returns the number of mirrored entries stored on the symbol's `events_v2` array (covered by the shared contract suite).

### RuleService (application)

- [ ] `RuleService.countSymbolEvents(symbolId)` delegates to the `EventLog` and returns the integer count for any symbol id (no `RuleNotFoundError` semantics — symbols outside the watchlist still respond with `0`).

### REST surface

- [ ] `GET /symbols/:id/rule-events/count` returns `200 { count: <integer> }`.
- [ ] `GET /symbols/:id/rule-events/count` returns `200 { count: 0 }` for a symbol with no events.

### Web hooks

- [ ] `useSymbolRuleEvents(symbolId, options?)` issues `GET /symbols/:id/rule-events` with the symbol's id encoded and optional `?limit` / `?before` parameters.
- [ ] `useSymbolRuleEventsCount(symbolId)` issues `GET /symbols/:id/rule-events/count` and returns the `count` integer.

### Symbol rule-events dialog

- [ ] When closed, the dialog renders only its trigger button labeled `Events` with a badge carrying the integer count.
- [ ] When the count exceeds `99`, the badge renders `99+`.
- [ ] When the count is `0`, the badge renders `0`.
- [ ] Opening the dialog reveals a title `Rule events for <symbol id>`.
- [ ] The table renders one column per documented header: `Source ts`, `Fired at`, `Rule`, `Type`, `Detail`.
- [ ] The table renders 15 rows per page by default and exposes the page count.
- [ ] Clicking the `Fired at` column toggles the sort axis to `firedAt` and reorders the rows; the default sort is newest-first on `firedAt`.
- [ ] Clicking the `Source ts` column toggles the sort axis to `ts` and reorders the rows.
- [ ] The `Detail` cell renders `StateSet` entries as `<key> = <value>`, `NotificationSent` entries as `<destinationName>: <body>`, `Error` entries as their `reason`, and `CycleOverflow` entries as `cycle limit: <cycleLimit>`.

### Chart page wiring

- [ ] `ChartPage` renders the Events button inside the bottom-bar `role="group"` named `Chart actions`.

## End-to-end expectation

The single happy path the e2e test asserts (against the API e2e harness):

1. Spin Mongo via testcontainers; wire `connectServices()`-equivalent.
2. Watch a symbol via the watchlist; POST a tick-cadence `EveryTime` `Price > 100` rule scoped to that symbol.
3. `GET /symbols/:id/rule-events/count` returns `{ count: 0 }`.
4. Drive a tick (price 101) through the live v2 quote bridge.
5. `GET /symbols/:id/rule-events/count` returns `{ count: 2 }` (a `Fired` umbrella entry plus the `StateSet` action entry).

## Out of scope

- Live websocket-driven count updates (the existing pattern fetches counts on dialog open; live mirroring lands later).
- Filtering by event type.
- Column-resizable / draggable tables.
- A dedicated count endpoint per rule (`/rules/:id/events/count`).

## Surprises

(Filled in retroactively if anything bites.)
