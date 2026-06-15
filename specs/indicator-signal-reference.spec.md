# Spec: signal-style reference indicator (VWMA + crossover)

- Status: approved
- Touches:
  - `core` — extend `FieldType` with `Enum`; add `EnumOption`, `EnumFieldDescriptor`, `EnumStateFieldDescriptor`; extend `RenderKind` with `Markers` and `Pane` with `Separate`; grow `InferFieldValue` / `InferStateValue` and `validateIndicatorInputs` to cover the enum case.
  - `engine` — `volumeWeightedMovingAverage` reference module under `packages/engine/src/indicators/vwma.ts`; register it in `defaultIndicators()` alongside the moving average.

## Goal

Add a second reference indicator that exercises the parts of the contract the moving average didn't — an **enum** input, a **separate-pane** output, a discrete **buy/sell signal** state field (rendered later as chart markers), and a **narrowed `appliesTo`** (the indicator consumes volume, so it excludes `Fx`).
The point is to prove the contract on a non-trivial indicator and to **grow the field vocabulary on its second instance**, not speculatively up front.

## Domain model

Extend the field-descriptor vocabulary:

- `FieldType.Enum` joins `Number` and `Source`.
- `EnumOption` — `{ value: string, label: string }`.
- `EnumFieldDescriptor<O extends readonly EnumOption[]>` — `{ type: Enum, key, label, options: O, default?: O[number]['value'] }`.
  The generic preserves the literal-union of option values for type-level inference.
- `EnumStateFieldDescriptor<O extends readonly EnumOption[]>` — same shape (`options: O`) plus optional display hints (`render`, `pane`, `color`), no `default` (state fields are outputs, not inputs).
- `RenderKind.Markers` joins `Line` — for discrete per-bar markers (e.g. buy/sell shapes).
- `Pane.Separate` joins `Overlay` — for state fields plotted in their own pane below the price chart.
- `InferFieldValue<D>` extends to: an `EnumFieldDescriptor<O>` resolves to `O[number]['value']` (the union of literal values).
- `InferStateValue<D>` extends to: an `EnumStateFieldDescriptor<O>` resolves to `O[number]['value'] | null`.
- `validateIndicatorInputs` extends to enum: applies `default` when value omitted; rejects a value that isn't in `options` (`IndicatorError`).

Reference indicator — `volumeWeightedMovingAverage` (key `vwma`):

- **Inputs:**
  - `length: NumberFieldDescriptor` — integer, min 1, max 1000, default 14.
  - `source: SourceFieldDescriptor` — default `PriceSource.Close`.
  - `multiplier: NumberFieldDescriptor` — min 0, default 1.0; minimum-deviation threshold in tenths-of-a-percent (signals fire only when `|source − value| / value ≥ multiplier × 0.001`).
  - `direction: EnumFieldDescriptor` — `'long-only' | 'both'`, default `'both'`.
- **State:**
  - `value: NumberStateFieldDescriptor` — the VWMA line (render `Line`, pane `Overlay`).
  - `signal: EnumStateFieldDescriptor` — `'buy' | 'sell'` options (render `Markers`, pane `Overlay`).
  - `confidence: NumberStateFieldDescriptor` — the deviation magnitude when a signal fires, else `null` (render `Line`, pane `Separate`).
- **`appliesTo`:** `[Crypto, Stock, Fund]` — excludes `Fx` (no volume).
- **Compute:**
  - For each bar `i`: warm-up (`i + 1 < length`) yields a row with all three state fields `null`.
  - Otherwise `value = Σ(source × volume) / Σ(volume)` over the trailing `length` bars; volume read via `resolveSource(candle, PriceSource.Volume)` so an FX candle would throw (a defensive backstop on top of `appliesTo`).
  - Signals require both a previous `value` (bar `i-1` past warm-up) **and** a deviation above the threshold:
    - **Up-cross** (`source[i] > value[i] && source[i-1] ≤ value[i-1]`) → `signal = 'buy'`.
    - **Down-cross** (`source[i] < value[i] && source[i-1] ≥ value[i-1]`) → `signal = 'sell'` (only when `direction === 'both'`; suppressed when `'long-only'`).
  - `confidence = |source[i] − value[i]| / value[i]` on a firing bar, else `null`.
  - **No look-ahead** — bar `t`'s state uses only candles `≤ t`.

## Acceptance criteria

Enum field-descriptor (`core`):

- [ ] `validateIndicatorInputs` accepts a valid enum value and returns it in the typed object (full-payload).
- [ ] `validateIndicatorInputs` applies the enum `default` when the value is omitted.
- [ ] `validateIndicatorInputs` rejects an enum value that isn't a member of `options` with `IndicatorError`.

`appliesTo` (`engine`):

- [ ] `volumeWeightedMovingAverage.definition.appliesTo` equals `[Crypto, Stock, Fund]` (excludes `Fx`); carried in the serializable metadata.

`compute` correctness, warm-up, and look-ahead (`engine`):

- [ ] On a known crypto candle fixture with `length = 3, multiplier = 1.0, direction = 'both'`, `compute` returns the expected per-bar `value` / `signal` / `confidence` series with the first two rows all-`null` (warm-up), a third row with `value` set and `signal: null` (no previous value to cross), a fourth row firing `signal: 'buy'` with the expected confidence, and a fifth row firing `signal: 'sell'` with the expected confidence (full-payload `toEqual`, `closeTo` floats).
- [ ] On the same fixture with `direction = 'long-only'`, the down-cross row yields `signal: null` (sell suppressed) while the up-cross row still fires `buy`.
- [ ] No look-ahead: the prefix produced by `compute(inputs, candles.slice(0, k))` equals the first `k` rows of `compute(inputs, candles)` for every `k`.
- [ ] On a candle series shorter than `length`, every row is all-`null` (silent).

Registry (`engine`):

- [ ] `defaultIndicators().list()` now contains both `sma` and `vwma` definitions; each one round-trips through `JSON.parse(JSON.stringify(...))` (no functions leak).

## End-to-end expectation

Same shape as the indicator-contract spec: a public-surface smoke test (not the Testcontainers e2e tier — there is no real infra to stand up for a pure-domain indicator).

- Happy path: `defaultIndicators().get('vwma')` returns the module → `validateIndicatorInputs(definition, { length: 3, multiplier: 1, direction: 'both' })` returns the typed inputs → `compute(inputs, cryptoCandles)` returns the expected aligned series (full-payload, `closeTo` floats).
- Critical failure mode: an invalid enum input (e.g. `direction: 'sideways'`) bubbles up as `IndicatorError` and never reaches `compute`.

The e2e tier picks this up when #14 (catalog API) or #16 (compute service) lands.

## Out of scope

- A third reference indicator — the vocabulary stays where the second instance leaves it (`Number`, `Source`, `Enum`).
- Additional render kinds beyond `Line` / `Markers` or panes beyond `Overlay` / `Separate`.
- Chart rendering of the markers / separate pane.
- The catalog API + CLI (#14), the compute service (#16), and attach-to-profile (#15).
- The action-condition grammar that addresses the new enum state field.

## Surprises

(Filled in retroactively if anything bites — empty by default.)
