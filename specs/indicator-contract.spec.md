# Spec: indicator definition contract

- Status: approved
- Touches:
  - `core` — `FieldType` / `PriceSource` enums, field-descriptor types (`NumberFieldDescriptor`, `SourceFieldDescriptor`, `NumberStateFieldDescriptor`), `IndicatorDefinition` + `IndicatorModule` types with `InferInputs<I>` / `InferStateSeries<S>` inference, `IndicatorError`, `resolveSource`, `validateIndicatorInputs`.
  - `engine` — `IndicatorRegistry`, the `defineIndicator` helper that constructs a module, `defaultIndicators()` factory mirroring `defaultMarketDataSources()`, and the first reference indicator (`movingAverage`) under `packages/engine/src/indicators/`.

## Goal

Establish a self-describing **indicator contract**: a typed, serializable structure that declares an indicator's input parameters and its per-candle output state, plus a pure `compute` function.
One contract serves three consumers (the last two land in their own issues): implementing modules in-repo, rendering UI input forms, and letting actions reference inputs/state as typed addressable fields.
Land it with a self-registering registry and one reference indicator (a moving average) so the whole path is proven end-to-end, not in the abstract.

## Domain model

Field-descriptor vocabulary (grows on its second instance, per the anti-dogma rule):

- `FieldType` enum with members `Number` and `Source`.
- `NumberFieldDescriptor` — `{ type: Number, key, label, integer?, min?, max?, step?, default? }`.
- `PriceSource` enum: `Open | High | Low | Close | HL2 | HLC3 | OHLC4 | Volume`.
- `SourceFieldDescriptor` — `{ type: Source, key, label, default? }` (default defaults to `PriceSource.Close`).
- `NumberStateFieldDescriptor` — same shape as a number input plus optional display hints (`render`, `pane`, `color`) carried generically for a future chart view.

`IndicatorDefinition<I, S>` (JSON-serializable metadata only):

- `key` — stable lookup id (e.g. `'sma'`).
- `name`, `description`.
- `version` — incremented when the descriptor schema changes; consumers (#15) record it on each attached instance.
- `appliesTo: SymbolType[]` — declared asset classes the indicator is valid for.
- `inputs: I extends readonly FieldDescriptor[]`.
- `state: S extends readonly StateFieldDescriptor[]`.

`IndicatorModule<I, S>` = `{ definition, compute }`, where `compute(inputs: InferInputs<I>, candles: Candle[]): InferStateSeries<S>`:

- `InferInputs<I>` maps each input descriptor's `key` to its value type (`number` for `Number`, `PriceSource` for `Source`).
- `InferStateSeries<S>` is `Array<{ time: number } & { [each state key]: number | null }>` — aligned 1:1 with the input candles.
- `compute` is **pure**, **no look-ahead** (state at bar *t* uses only candles ≤ *t*), returns a row per candle with state fields `null` during warm-up and the **whole series all-`null`** when the input is too short (silent — no error).

`resolveSource(candle, source)` maps a `PriceSource` to a numeric value: `Open`/`High`/`Low`/`Close` direct, `HL2`/`HLC3`/`OHLC4` averaged, `Volume` taken from the candle when the asset class carries it (rejects on `FxCandle`).

`validateIndicatorInputs(definition, values)` walks the input descriptors and returns a typed object:

- A required input with no value and no `default` is rejected.
- A value of the wrong type (non-number for `Number`, non-`PriceSource` for `Source`) is rejected.
- A `Number` value outside `[min, max]` or non-integer when `integer: true` is rejected.
- Throws `IndicatorError` on any failure.

Registry — `IndicatorRegistry` (in `engine`):

- `register(module)`, `list(): IndicatorDefinition[]`, `get(key): IndicatorModule | null`.
- `defineIndicator(spec)` is a pure factory: it constructs an `IndicatorModule` (no side effects) and defaults `appliesTo` to **all** `SymbolType`s when omitted.
- `defaultIndicators(): IndicatorRegistry` mirrors `defaultMarketDataSources()` — it instantiates an empty registry, calls `register` for each shipped module (just `movingAverage` here), and returns it.
- Consumers (catalog API, compute service, etc.) receive the registry via dependency injection; no module-level mutable state.

Reference indicator — `movingAverage` (under `packages/engine/src/indicators/sma.ts`):

- Inputs: `length: NumberFieldDescriptor` (integer, min 1, default 14) + `source: SourceFieldDescriptor` (default `Close`).
- State: a single `value: NumberStateFieldDescriptor` (render `line`, pane `overlay`).
- `appliesTo`: all four `SymbolType`s.
- `compute`: simple moving average of the resolved source over the last `length` candles; positions `< length - 1` get `null` (warm-up); positions `>= length - 1` get the mean of the trailing window.

## Acceptance criteria

Field descriptors and validation (`core`):

- [ ] `validateIndicatorInputs` accepts a fully-supplied valid payload and returns the typed object unchanged (full-payload `toEqual`).
- [ ] `validateIndicatorInputs` applies a number input's `default` when the value is omitted.
- [ ] `validateIndicatorInputs` rejects a number value outside `[min, max]` (or non-integer when `integer: true`) with `IndicatorError`.
- [ ] `validateIndicatorInputs` rejects a source value that isn't a member of `PriceSource` with `IndicatorError`.
- [ ] `validateIndicatorInputs` rejects a required value with no default and no input with `IndicatorError`.

`resolveSource` (`core`):

- [ ] Returns the correct numeric for each `PriceSource` against a crypto candle fixture (incl. `HL2` / `HLC3` / `OHLC4` averaged correctly, `closeTo` floats).
- [ ] Returns `volume` for crypto and equity candles; rejects `Volume` against an FX candle with `IndicatorError`.

`IndicatorDefinition` serializability (`core`):

- [ ] `JSON.parse(JSON.stringify(module.definition))` equals `module.definition` for the moving-average module — only data, no functions leak (full-payload).

Registry + `defineIndicator` (`engine`):

- [ ] `defineIndicator(spec)` returns an `IndicatorModule` whose `definition` carries the supplied fields verbatim and whose `compute` is the supplied function (full-payload).
- [ ] `defineIndicator` defaults `appliesTo` to every `SymbolType` when omitted; an explicit `appliesTo` is preserved.
- [ ] `IndicatorRegistry.register` + `list`/`get` round-trip a module; `get('unknown')` returns `null`.
- [ ] `defaultIndicators()` returns a registry whose `list()` includes the moving-average definition; `get('sma')` returns the moving-average module.

Moving-average compute (`engine`):

- [ ] `movingAverage.compute({ length: 3, source: PriceSource.Close }, candles)` over a known crypto candle fixture returns an aligned series whose first two rows have `value: null` (warm-up) and whose subsequent rows match the closed-form SMA (full-payload `toEqual`, `closeTo` floats).
- [ ] `movingAverage.compute({ length: 5, ... }, fewerThan5Candles)` returns a series of the same length with every `value: null` — silent, no error.
- [ ] `movingAverage.compute` does not use look-ahead — the state at bar `t` is the same whether `compute` was given candles `[0..t]` or `[0..t+k]` (asserted by comparing the truncated vs full series).

## End-to-end expectation

This issue is a domain-only contract — no API endpoint, no Mongo persistence, no streaming.
The "end-to-end" smoke-test is the **reference module exercised through the public surface** (`@lametrader/engine` exports):

- Happy path: import `defaultIndicators` from `@lametrader/engine`; assert the returned registry's `get('sma')` returns the moving-average module; call `validateIndicatorInputs(definition, { length: 3 })`; pass the validated inputs into `compute(...)` over a real-typed crypto candle series; assert the resulting series (full-payload, `closeTo` floats).
- Critical failure mode: invalid inputs (e.g. `length: 0`) bubble up as `IndicatorError` and never reach `compute`.

Placed as a standard unit test under `engine/src/indicators/sma.contract-smoke.test.ts` (not the e2e tier — there is no real-infra to stand up, and adding a Testcontainers run for a pure-domain contract would be over-engineering).
The e2e tier picks this up when #14 (catalog API) or #16 (compute service) lands.

## Out of scope

- A second reference indicator (enum input + buy/sell signal) — that's #13.
- The catalog API + CLI (`GET /indicators`) — that's #14.
- Chart rendering of the display hints.
- Attaching indicators to profiles (`IndicatorInstance`) — that's #15.
- Computing/serving an attached indicator's results over stored candles — that's #16.
- The action-condition grammar that addresses state fields by key (later).

## Surprises

(Filled in retroactively if anything bites — empty by default.)
