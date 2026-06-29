# Spec: chart state overlays

- Status: implemented
- Touches:
  - `engine` — new `StateHistoryService` (application use-case) derives the per-symbol state-key catalog and time-series for one `(symbolId, profileId, key)` from the existing `EventLog.symbolEvents()` (`StateSet`/`StateRemoved` entries).
  - `api` — two new endpoints under the existing `symbols` controller: `GET /symbols/:id/state-keys?profileId=` (catalog) and `GET /symbols/:id/state/:key/series?profileId=&from=&to=` (time-series).
  - `web` — `useSymbolStateKeys(symbolId, profileId)` + `useSymbolStateTimeSeries(symbolId, profileId, key, from, to)` hooks; new `StatesPanelDialog` mirroring `IndicatorPanelDialog`; new `StateOverlay` descriptor and chart sync extending the existing overlay infrastructure (line for numeric, markers for bool/enum/string); the **States** button mounted next to **Indicators** on the chart bottom bar.

## Goal

Let users overlay symbol-state values onto the chart for the current `(symbolId, profileId)` — the same affordance as **Indicators**, but for state mutated by rules.
History comes from the already-persisted rule-event log (`StateSet`/`StateRemoved` on `events_v2`); no schema change.
Live updates ride a 5 s `refetchInterval` on the events-log poll so a fresh `StateSet` in the visible window appears without a manual action.

## Domain model

`StateHistoryEntry`:

```ts
/** One sample on a state key's time-series. `value === null` marks a removal. */
interface StateHistoryEntry {
  /** Source timestamp from the originating rule event (epoch ms). */
  ts: number;
  /** The new value at `ts`, or `null` when the key was removed at `ts`. */
  value: StateValue | null;
}
```

`StateKeyDescriptor`:

```ts
/** One known state-key for a symbol — what the picker lists. */
interface StateKeyDescriptor {
  /** The key written by the rule (e.g. `'last_signal'`). */
  key: string;
  /** The value type observed most recently. Drives the rendering choice. */
  valueType: StateValueType;
}
```

`StateHistoryService` (in `engine`):

```ts
class StateHistoryService {
  constructor(eventLog: EventLog);
  /** Distinct (key, valueType) seen in the symbol's mirrored StateSet events. */
  listKeys(symbolId: string): Promise<StateKeyDescriptor[]>;
  /** Time-series for one (key) on the symbol within [from, to). `null` value entries denote removals. */
  series(
    symbolId: string,
    key: string,
    window: { from?: number; to?: number },
  ): Promise<StateHistoryEntry[]>;
}
```

The service does NOT filter by `profileId` — `RuleEventEntry` carries no `profileId` field today, and adding one would require a persisted-schema change.
The picker takes `profileId` from the URL and threads it through for symmetry with the rest of the chart UI, but every key persisted against the symbol is listed regardless of which profile's rule wrote it.
Multi-profile state filtering is a follow-up that lands with the persisted-schema bump (out of scope here).

`GET /symbols/:id/state-keys`

Returns `StateKeyDescriptor[]`, alphabetical by key.
404 when the symbol isn't on the watchlist (same envelope as the existing `/symbols/:id/state` route).

`GET /symbols/:id/state/:key/series?from=&to=`

Returns `StateHistoryEntry[]`, ascending by `ts`.
`from` (inclusive) / `to` (exclusive) are optional epoch ms; absent ⇒ no bound on that side.
404 on unwatched symbol.

Web side:

`useSymbolStateKeys(symbolId, profileId)` reads the catalog with `refetchInterval = 5_000` so a fresh `StateSet` introduces its key into the picker without an action.

`useSymbolStateTimeSeries(symbolId, profileId, key, from, to)` reads the series with the same `refetchInterval` so a fresh `StateSet`/`StateRemoved` in the visible window shows up on the overlay.

`StateOverlay` (web): mirrors `IndicatorOverlay` — one entry per selected state key, carries the symbol id, profile id, key, the series, a colour, a visible flag, and the `valueType` so the renderer picks line (numeric) vs markers (bool/enum/string).

`StatesPanelDialog` (web): the button + dialog, modeled on `IndicatorPanelDialog`. Trigger shows count badge of currently overlaid keys. Dialog body is the picker: search input + scrollable list + per-key checkbox.

Selected keys persist to `localStorage` keyed by `${profileId}::${symbolId}` (chart-local, same family as `chart-period.ts` etc.).

## Acceptance criteria

`StateHistoryService.listKeys`:

- [ ] Returns the distinct `(key, valueType)` pairs from symbol-scoped `StateSet` entries in the symbol's mirrored events, alphabetical by key (full-payload `toEqual`).
- [ ] Drops `StateSet` entries on `StateScope.Global` (global state isn't symbol-keyed).
- [ ] Returns `[]` when the symbol has no events.

`StateHistoryService.series`:

- [ ] Returns one entry per `StateSet` (`{ts, value}`) and one per `StateRemoved` (`{ts, value: null}`) for the given key, ascending by `ts`.
- [ ] Filters by `key` exactly — entries for a different key are dropped.
- [ ] Honors `from` (inclusive) — entries with `ts < from` are dropped.
- [ ] Honors `to` (exclusive) — entries with `ts >= to` are dropped.
- [ ] Returns `[]` when no `StateSet`/`StateRemoved` matches.

API `GET /symbols/:id/state-keys`:

- [ ] Returns 200 with the alphabetical key list when the symbol is watched.
- [ ] Returns 404 when the symbol is not on the watchlist.

API `GET /symbols/:id/state/:key/series`:

- [ ] Returns 200 with the series, ascending by `ts`, when the symbol is watched.
- [ ] Honors `from` / `to` query params (epoch ms).
- [ ] Returns 404 when the symbol is not on the watchlist.

Web `useSymbolStateKeys`:

- [ ] Issues `GET /symbols/{id}/state-keys` and returns the catalog (full-payload `toEqual` over the resolved data).

Web `useSymbolStateTimeSeries`:

- [ ] Issues `GET /symbols/{id}/state/{key}/series?from=...&to=...` with the supplied window and returns the series.

Web `StatesPanelDialog`:

- [ ] Trigger renders with the `States (N)` accessible name where `N` is the count of currently overlaid keys persisted for `(profileId, symbolId)`.
- [ ] Clicking the trigger opens a dialog whose body shows a search input and a scrollable list of one checkbox per key from `useSymbolStateKeys`.
- [ ] Toggling a checkbox persists the next selection set to `localStorage` under the `(profileId, symbolId)` namespace, and the trigger's badge count updates.
- [ ] When no profile is selected the dialog renders the warning callout (same pattern as `IndicatorPanelDialog`).

Web chart overlay sync (extend existing):

- [ ] A numeric `StateOverlay` adds one step-line series via `chart.addSeries(LineSeries, ...)` and pushes the series points (full-payload `toEqual` on the per-row mapping).
- [ ] A bool / string / enum `StateOverlay` adds markers on the candle series via `createSeriesMarkers(...)` — one marker per transition.

## End-to-end expectation

`packages/api/tests/e2e/chart-state-overlays.e2e.test.ts`:

- Watch a symbol, append two `StateSet` entries (different keys) and one `StateRemoved` on the same symbol via `eventLog.appendSymbolEvent(...)`.
- `GET /symbols/{id}/state-keys` returns both keys with their value types, alphabetical.
- `GET /symbols/{id}/state/{key1}/series` returns the value-then-removal series ordered by `ts`.
- Critical failure mode: the same routes against an unwatched id return 404.

## Out of scope

- A separate `state-history` collection or append-only `StateRepository` (Q1.B / Q1.C in the issue) — sticking with the event-log source keeps zero schema change.
- An explicit "register state key" step in the rule editor (Q2.B) — the picker derives the catalog from already-written events, so newly-mutated keys appear automatically.
- A dedicated `StreamKind.State` stream channel — the existing live-stream spec (`chart-rule-events-live-stream.spec.md`) covers that pattern; until it lands, a 5 s `refetchInterval` is good enough.
- Picking up direct API state writes (writes that bypass the rule engine and don't emit an event) — flagged in the issue as a known limitation of Q1.A; out of scope here.
- A separate pane for state series — overlays sit on the price pane only.
- Per-key colour customization — the overlay palette already handles distinct colors automatically.

## Surprises

(Filled in retroactively if anything bites — empty by default.)
