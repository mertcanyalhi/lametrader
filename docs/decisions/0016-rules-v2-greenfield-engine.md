# rules-v2: greenfield engine with per-tick / per-bar trigger taxonomy and series-aware operators

- Status: accepted

## Context

The existing rule engine (ADR 0012, refined by #357 / #362 / #369) couples cadence to operand axis: `Current` is implicitly tick-axis (driven by `QuoteStreamService`) and `Close` is implicitly bar-axis (driven by candle polling).
The user-visible bug (#381 et al.) is that `Current crossing X` rules silently misbehave depending on which event drives evaluation — they fire on the wrong event under tick bursts, mix close-axis prev into quote-axis crossings, or never fire at all under polling-only flow.
The fixes attempted in #357 / #362 closed one set of axis-mixing bugs but exposed the inverse failure mode (`Current crossing` never fires when only candle polling is active because `resolvePrevCurrent` returns `prev === current` for any non-matching event).

The operator vocabulary is also too thin for the strategies the platform wants to support: real strategies need lookback-past-flats `Crossing` semantics (consolidation at a threshold should still count as a cross), `Entering / Exiting / Inside channel` against operand-typed bounds, and `Moving up / down` over N bars (absolute or percentage).
Today's snapshot-only (`prev`, `current`) evaluation surface can't express these without history.

Two underlying choices forced a rewrite rather than another refactor:

1. **Decouple cadence from operand axis.** The trigger should explicitly declare whether the rule re-evaluates per-tick or per-bar; operands resolve from their own source independently.
   Refactoring v1's implicit coupling would break most of its existing invariants for marginal benefit.
2. **Add series storage.** The current `EvaluationContext` is snapshot-only.
   Series-aware operators require a new lookup surface that v1 fights against.

Combined with cumulative debt from incremental fixes (#290, #281, #354, #357, #362), greenfield is cheaper than another refactor.

## Decision

Build rules-v2 as a parallel greenfield engine + schema + UI.
v1 stays in production until v2 ships behind a feature flag; the maintainer removes v1 rules and flips the flag; a cleanup issue retires v1's code after no profile uses it.

Locked design pillars:

1. **Cadence taxonomy.** Three cadences (tick, bar, periodic) drive six triggers: `EveryTime`, `Once`, `OncePerBar` (per-tick re-eval with bar-aligned latch), `OncePerBarOpen`, `OncePerBarClose`, `OncePerInterval` (wall-clock duration).
2. **Tick source = live quote stream only.** Per-tick triggers require a live `QuoteStreamService` subscription; rules on polled-only symbols fail validation. No synthesized ticks.
3. **Explicit bar lifecycle events.** `PollingService` emits `BarOpened(symbolId, period, ts)` and `BarClosed(symbolId, period, ts)` as evaluation triggers. Existing per-axis OHLCV-change events stay as data-update events for cache fill but no longer drive evaluation.
4. **Hybrid series storage.** Bar series read live from the candle repository (already persisted; no duplication). Tick series in an in-memory ring buffer per symbol (ephemeral by nature). Indicator series in-memory, recomputed from bars on startup via `IndicatorService`.
5. **Series alignment — walk on left operand's native timeline.** Right operand is resampled as "latest observed value as of this timestamp". Operand order is semantically meaningful for `Crossing` / `Channel` / `Moving`.
6. **Operand catalog — 10 kinds; rename `Current → Price` end-to-end.** Engine, schema, logs, and UI all use `Price`.
7. **Indicator binding — profile-attached instances only.** Operand carries `(instanceId, stateKey)`; the condition row's `Interval` filters the picker to instances on that period. No inline-parameterized indicators on the condition row.
8. **Operator vocabulary.** Comparison (6), `Crossing` (3, lookback-past-flats), `Channel` (3: Entering/Exiting/Inside, full-operand bounds), `Moving` (4: up/down × abs/%, scalar threshold + integer lookback-bars), State (4, preserved). Bool single-operand is sugared in the UI as the operand alone but stored as `Equals(operand, Literal(true))`.
9. **Rule scope.** `Symbol`, `Symbols(list)`, `AllSymbols`. Fan out per symbol; operands always read from the firing symbol.
10. **Action shape — single `Notification` kind with `channel` discriminator.** v2 ships with `channel: 'telegram'` only; schema extensible for email/slack/webhook/in-app. State mutations + cascade re-entry preserved from v1.
11. **Validation — schema-only at create-time.** The schema validator is the single trust boundary. Engine trusts the schema at evaluation. NULL operands stay handled as operator semantics, not type bugs.
12. **Migration — hard cutover by the maintainer.** No automated script. The maintainer deletes v1 rules via UI/API and flips the v2 feature flag.

## Considered Options

- **Refactor v1 in place.** Rejected: each prior refactor (#357 / #362 / #369) closed one axis-mixing bug and opened another; v1's snapshot-only `EvaluationContext` can't host series-aware operators without invasive surgery that breaks most of its existing invariants. Cumulative debt makes a rewrite cheaper.
- **Inline-parameterized indicators on condition rows.** Rejected: maintenance burden of letting any rule request any (indicator, params, period) tuple exceeds the UX win; profile-attached instances keep the `IndicatorService` surface narrow.
- **Cross-symbol operand references** (`BTC.Price > ETH.Price`). Rejected: an explicit `symbolId` on every operand widens the validator + UI surface; no current use case in scope.
- **Synthesized ticks from polled candle closes.** Rejected: re-creates the axis-mixing trap #381 just untangled in a different form.
- **Walk on a merged timeline of both operands' native events for cross-frequency `Crossing`.** Rejected: operand-order-as-semantics is simpler and gives the user explicit control.
- **Automated v1 → v2 migration script.** Rejected: v1 has no concept of v2's per-condition `Interval`, channel/moving operators, or `Price` rename — the transform would be lossy. Manual recreate is cleaner.
- **Runtime type-mismatch guards in the engine.** Rejected: the schema validator is the single trust boundary; runtime null-handling stays as operator semantics.

## Consequences

- Two parallel engines coexist in the codebase from phase 1 through cutover. Old + new types, services, controllers, and UI routes ship simultaneously behind a feature flag.
- Series-aware operators introduce a new in-memory cost — per-symbol tick ring buffers. Bounded; indicator history is recomputed from bars at startup, not persisted.
- Per-tick triggers add a new validation constraint: only symbols with an active quote subscription can carry rules whose trigger granularity is tick. The rule editor must surface this when the user picks a per-tick trigger on a symbol without a quote stream.
- Operand order becomes semantically meaningful for `Crossing` / `Channel` / `Moving`. The UI must communicate this when the user composes a condition.
- The cleanup follow-up issue retires v1 (`condition-evaluator`, `trigger-evaluator`, `action-runner`, `live-evaluation-lookups`, old `TriggerKind` enum, old rule-editor UI, old REST surface) once no profile uses v1.
