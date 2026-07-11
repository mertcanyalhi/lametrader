# Spec: non-numeric (Bool / String) IndicatorRef state-field resolution

- Status: accepted
- Decision: the single-projected-series story is recorded in ADR-0022.
- Touches: `core` indicator types + backend indicator-definition DTO; `analytics/rules` projection (`indicator-series-view.ts`) + resolution (`evaluation-context.ts`) + wire-up (`wire-rule-engine.ts`); `analytics/indicators/vwma.ts`; `ui` operand picker.

## Goal

Let a rule's `IndicatorRef` operand resolve a **non-numeric** indicator state field — a `Bool` field or an enum-`String` field — through the snapshot / state operators (`Equals` / `NotEquals` / `ChangesTo` / `ChangesFrom`), end-to-end.
Today the projection wraps only finite numbers, so a bool/enum field silently resolves to `null` and rules referencing it never fire.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] `toStateValue` wraps a finite number as `{ type: Number }`, a boolean as `{ type: Bool }`, a string as `{ type: String }`, and returns `null` for `null` / `undefined` / other shapes (unit, full-payload).
- [ ] A `Bool`-typed `IndicatorRef` LHS with `StateOperator.Equals` against `Literal(true)` fires when the indicator's current field is `true` and does not when it is `false` (unit, full-payload).
- [ ] A `String`/enum-typed `IndicatorRef` LHS with `StateOperator.Equals` / `NotEquals` against a string literal evaluates correctly (unit, full-payload).
- [ ] `ChangesTo` / `ChangesFrom` on a non-numeric `IndicatorRef` resolve both `latest` and `prev` from the single projected series consistently — no `latest === null` asymmetry (unit, full-payload).
- [ ] `resolvePrev` for an `IndicatorRef` derives `prev` from the series' second-newest projected point with no `getPrevIndicator` fallback dep (the half-path is removed) (unit, full-payload).
- [ ] VWMA emits a persistent `Bool` state field `above` (resolved source above the VWMA line, non-null post-warm-up) alongside its existing enum `signal` (unit, full-payload).
- [ ] The core `FieldType` gains `Bool`, a `BoolStateFieldDescriptor` joins the `StateFieldDescriptor` union, and `InferStateValue` infers `boolean | null` for it (unit / typecheck).
- [ ] The UI operand picker maps a `FieldType.Bool` state field to `StateValueType.Bool` (unit).
- [ ] The read-time `normalizeRule` migration keeps a `state/Equals` (or `NotEquals`) leaf whose LHS is a non-numeric `IndicatorRef` (`valueType` `Bool` / `String`) in the State family — only a numeric `IndicatorRef` (or a legacy operand without `valueType`) still rewrites to `comparison/Eq` (unit, full-payload). Without this a persisted bool/enum rule is silently rewritten to a numeric comparison that never fires.

## End-to-end expectation

Boot the real Nest app with a VWMA instance attached to an enabled profile.
Feed a live closing bar that produces an up-cross so VWMA emits `signal = 'buy'` and `above = true`.

- A rule `IndicatorRef(vwma.signal) Equals Literal('buy')` fires (String field, real compute).
- A rule `IndicatorRef(vwma.above) Equals Literal(true)` fires (Bool field, real compute).

Critical failure mode: a bar where the source sits below the line yields `above = false`, and a `IndicatorRef(vwma.above) Equals Literal(true)` rule does **not** fire.

## Out of scope

- Series-aware operators (`Crossing` / `Moving` / `Channel`) on non-numeric fields — numeric by nature, out of scope per the issue.
- A separate snapshot-lookup dependency for non-numeric fields — the single projected-series path replaces it.

## Surprises

(filled in after landing)
