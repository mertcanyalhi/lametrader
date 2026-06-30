# Spec: rules core types

- Status: draft
- Touches: `@lametrader/core` — new `` namespace.

## Goal

Pure-types surface for the rules engine in `@lametrader/core`, namespaced as `` so the v1 type union stays intact during the parallel build (per ADR 0016).
No runtime logic — just the tagged unions every downstream phase (#389 schema, #390 storage, …) consumes.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] `.Trigger` admits an `EveryTime` variant with only a `kind` field.
- [ ] `.Trigger` admits a `Once` variant with only a `kind` field.
- [ ] `.Trigger` admits an `OncePerBar` variant carrying a `Period`.
- [ ] `.Trigger` admits an `OncePerBarOpen` variant carrying a `Period`.
- [ ] `.Trigger` admits an `OncePerBarClose` variant carrying a `Period`.
- [ ] `.Trigger` admits an `OncePerInterval` variant carrying `intervalMs: number`.
- [ ] `.EvaluationTriggerEvent` admits a `Tick` variant carrying `{ ts, symbolId, price }`.
- [ ] `.EvaluationTriggerEvent` admits a `BarOpened` variant carrying `{ ts, symbolId, period }`.
- [ ] `.EvaluationTriggerEvent` admits a `BarClosed` variant carrying `{ ts, symbolId, period }`.
- [ ] `.EvaluationTriggerEvent` admits a `Timer` variant carrying `{ ts }`.
- [ ] `.EvaluationTriggerEvent` admits `SymbolStateChanged` / `GlobalStateChanged` / `IndicatorChanged` cascade triggers.
- [ ] `.DataUpdateEvent` admits per-axis OHLCV variants (`Open`, `High`, `Low`, `Close`, `Volume`).
- [ ] `.ConditionOperand` exposes ten kinds — `Price`, `Open`, `High`, `Low`, `Close`, `Volume`, `IndicatorRef`, `SymbolStateRef`, `GlobalStateRef`, `Literal` — with `Price` replacing v1's `CurrentValue`.
- [ ] `.Operator` covers five families: Comparison (6), Crossing (3), Channel (3), Moving (4), State (4).
- [ ] `.LeafCondition` is a discriminated union by operator family — `comparison`/`crossing`/`state` carry `(left, right)`; `channel` carries `(left, lower, upper)`; `moving` carries `(left, threshold, lookbackBars)`. All variants may carry an optional `interval: Period`.
- [ ] A bool-operand shortcut is expressible as `Equals(operand, Literal(true))` — no separate `IsTruthy` operator.
- [ ] `.RuleScope` admits `Symbol`, `Symbols(list)`, and `AllSymbols` variants.
- [ ] `.Action` admits a single `Notification` kind carrying a `channel: 'telegram'` discriminator plus `{ destinationName, template }`, and the four state-mutation kinds (`SetSymbolState`, `RemoveSymbolState`, `SetGlobalState`, `RemoveGlobalState`).
- [ ] `.Rule` carries `{ id, profileId, name, description?, scope, condition, trigger, expiration, actions, enabled, order, createdAt, updatedAt }`.
- [ ] v1 exports (`Trigger`, `Rule`, `Action`, `OperandKind`, …) keep their original shapes after the v2 namespace is added — no symbol collisions.

## End-to-end expectation

Out of scope — there is no runtime behavior to exercise.
The "end-to-end" gate for this slice is `npm run typecheck` passing across the workspace with the new namespace re-exported and consumed.
A subsequent slice (#389) adds the schema validator and that slice owns the first runtime tests.

## Out of scope

- Schema validation (own issue: #389).
- Repositories, services, controllers, UI, engine wiring (later phases).
- Runtime type guards or constructors — the engine trusts the schema, types stay pure.
- `e2e` tier — nothing to drive end-to-end yet.

## Surprises

(empty for now)
