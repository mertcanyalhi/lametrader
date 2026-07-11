# Non-numeric `IndicatorRef` state fields resolve through the single projected series

- Status: accepted

## Context

The rules engine's `IndicatorRef` operand can point at any state field an indicator emits, and the operand already carries a `valueType: StateValueType` (`{ String, Number, Bool }`, ADR-0013).
The `State` operators (`Equals` / `NotEquals` / `ChangesTo` / `ChangesFrom`) are already type-agnostic — `nullableEquals` matches on the tagged `{ type, value }`, so string and bool equality work for `SymbolStateRef` / `GlobalStateRef` today.

Only the `IndicatorRef` **resolution** path was number-only.
`toStateValue` (the projection choke point in `indicator-series-view.ts`) wrapped only finite numbers and returned `null` for everything else, so `PagedIndicatorSeriesView` never yielded a string/bool point.
That left an asymmetry: `resolveLatest` resolved an `IndicatorRef` solely through the numeric series view (a bool/enum field always came back `null`), while `resolvePrev` had grown an optional `getPrevIndicator` fallback hook — wired to `() => null` — to anticipate the same non-numeric keys "not projected into the in-memory series store".
Net effect for a bool/enum indicator field: `prev` had a (dead) escape hatch but `latest` was always `null`, so `Equals` never fired and `ChangesTo` / `ChangesFrom` were inconsistent.

Two real non-numeric VWMA fields now exist as the "second instance" that justifies closing the gap: the sparse enum-`String` `signal` (`buy` / `sell`, `null` between crosses) and a new persistent `Bool` `above` (source sits above the line, set every warmed bar).

## Decision

Extend `toStateValue` to project all three shapes the engine understands — a finite number → `{ type: Number }`, a boolean → `{ type: Bool }`, a string → `{ type: String }` — and still `null` for `null` / `undefined` / any other shape.

Because `toStateValue` is the single projection point feeding **both** `resolveLatest`'s `asOf` and `resolvePrev`'s backward series walk, non-numeric fields now resolve through the exact same path as numeric ones.
The latest/prev asymmetry disappears, so the `getPrevIndicator` fallback becomes redundant: its dep, its `() => null` wiring, and its doc are removed.
`prev` is unconditionally the series' second-newest projected point.

Add `FieldType.Bool` + a `BoolStateFieldDescriptor` to the indicator vocabulary in `core` (mirrored in the backend Swagger DTO) so an indicator can declare a first-class boolean state field; a `String` indicator field stays modelled as `Enum` (VWMA's `signal`).

## Considered Options

- **Snapshot-only lookup for non-numeric fields** — keep the paged view numeric-only and route bool/string fields through a new `getLatestIndicator` dep symmetric to `getPrevIndicator`.
  Rejected: it preserves two half-paths (series for numbers, snapshot for the rest), duplicates the resolution logic, and needs a second live wiring to stay in sync.
  Extending the one projection point is a strictly smaller, single-path change and lets us delete the `prev` fallback instead of adding a `latest` one.

## Consequences

- **The projected read is "sticky" — last known non-`null`.** `asOf` returns the newest projected point at or before the query, and a `null`-projecting row (warm-up or a sparse field's non-firing bar) is skipped, not yielded.
  - For a **persistent** bool field (VWMA `above`, set every warmed bar) this is exactly the current bar's value, and `prev` is the prior bar's — the natural per-bar transition `ChangesTo` / `ChangesFrom` key off.
  - For a **sparse** event-like field (VWMA `signal`, `null` between crosses) the latest read is the *last emitted signal*, and `prev` is the signal before it — `ChangesTo('sell')` fires on the bar the signal flips from a prior `buy` to `sell`, not on every intervening `null` bar.
  This matches how a discrete marker field is meant to be read (you compare against the standing signal), and it is documented inline on `toStateValue`.
- **One resolution path, no dead hook.** Removing `getPrevIndicator` collapses the engine to a single series-backed path for every `IndicatorRef` value type; `cascade-prev-state-threading.spec.md` is updated to note the fallback is gone.
- **Series-aware operators stay numeric.** `Crossing` / `Moving` / `Channel` are numeric by nature and out of scope; a bool/enum field only participates in the snapshot/state operators.
- **The `#429` equality-collapse migration gains a non-numeric carve-out.** `normalizeRule` (read-time) rewrote any `state/Equals` / `NotEquals` leaf with a non-state-ref LHS to `comparison/Eq` — correct while every non-state-ref LHS was numeric, but `comparison/Eq` is numeric-only and silently evaluates a bool/enum field to `false`.
  It now also keeps the State family when the LHS is an `IndicatorRef` whose `valueType` is `Bool` / `String`; a numeric `IndicatorRef` (or a legacy operand without a `valueType`) still rewrites, so there is no regression for numeric indicator equality.
  This is the persistence-layer half of the same gap the resolution path closes — without it a persisted bool/enum rule round-trips into a numeric comparison that never fires.

## Closes

#562.
