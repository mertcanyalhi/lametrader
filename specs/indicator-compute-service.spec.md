# Spec: indicator compute service (ad-hoc historical series)

- Status: approved
- Touches:
  - `core` — `IndicatorComputeResult` type (`{ indicatorKey, version, period, state }`); `validateIndicatorInputs` softens to coerce numeric strings into numbers (HTTP query-string boundary fix).
  - `engine` — `IndicatorComputeService` (resolves indicator from `IndicatorRegistry`, validates inputs against descriptors, loads candles via `CandleRepository`, runs `compute`, slices result to the requested range); wired into `connectServices` (alongside the existing services); exported.
  - `api` — `GET /symbols/:id/indicators/:key` route on the indicators controller (querystring carries `period`, optional `from`/`to`, plus the indicator's scalar inputs); permissive querystring schema to admit per-indicator keys; `app.types.ts` gains `indicatorCompute?: IndicatorComputeService`; `app-deps.ts` and `main.ts` wire it.
  - `cli` — `indicators compute <symbolId> <indicatorKey> --period <p> [--from <ms>] [--to <ms>] [--inputs '<json>']` subcommand.
  - READMEs — `api` and `cli` Indicators sections gain the compute surface.

## Goal

Introduce the **compute primitive** — run a registered indicator with given inputs over a symbol+period's stored candles and return an aligned state series — and expose it as an **ad-hoc read API**.
Request-driven, computed **on read** (no persistence), over **confirmed/historical** candles only.
This is the shared foundation the live chart and (later) actions reuse; per "abstract on the second instance," it's introduced here with its first consumer rather than pre-factored.

## Domain model

`IndicatorComputeResult` (serializable):

```ts
{
  indicatorKey: string;
  version: number;          // definition.version recorded at compute time
  period: Period;
  state: Array<{ time: number } & Record<string, unknown>>;
}
```

`IndicatorComputeService.compute(symbolId, indicatorKey, inputs, period, range?) → IndicatorComputeResult`:

1. **Symbol lookup** — `watchlist.get(symbolId)` → throw `SymbolNotFoundError` (404) when not watched.
2. **Indicator lookup** — `registry.get(indicatorKey)` → throw `IndicatorNotFoundError` (404) when missing.
3. **Asset-class check** — `symbol.type ∈ definition.appliesTo`; throw `IndicatorError` (400) on mismatch.
4. **Inputs validation** — `validateIndicatorInputs(definition, inputs)` (throws `IndicatorError` (400) on type/range/required failures).
5. **Load candles** — `candles.range(symbolId, period, 0, range.to ?? +∞)`.
   Compute from the **earliest stored candle** up to `to` so the first returned point of a requested sub-range is already past warm-up.
6. **Compute** — `module.compute(validated, allCandles)`.
7. **Slice** — keep state rows whose `time ∈ [range.from, range.to)` (both inclusive of the explicit defaults: `0` and `+∞` when omitted).
8. **Return** — `{ indicatorKey, version: definition.version, period, state }`.

**`validateIndicatorInputs` softening:**
Numeric inputs accept a numeric string (e.g. `"14"`) in addition to a `number`, so HTTP query-string values pass without per-controller coercion.
Non-numeric strings still fail the type check; range / integer / required checks are unchanged.

## API

`GET /symbols/:id/indicators/:key?period=…&from=…&to=…&<inputs…>`:

- **200** with `IndicatorComputeResult`.
- **404** with `{ error }` when the symbol is not watched or the indicator key is unknown.
- **400** with `{ error }` on invalid inputs / asset-class mismatch / missing `period` / malformed `from`/`to`.

Querystring schema admits **additional** properties (per-indicator input keys like `length`, `source`, `multiplier`).
The known params (`period`, `from`, `to`) are typed; the rest pass through as a permissive `Record<string, unknown>` and the service validates them against the indicator's descriptors.

## CLI

`lametrader indicators compute <symbolId> <indicatorKey> --period <p> [--from <ms>] [--to <ms>] [--inputs '<json>']`:

- Prints the `IndicatorComputeResult` as JSON.
- `--inputs` is a JSON literal of indicator-specific values (e.g. `'{"length":5}'`); when omitted, the indicator's descriptor defaults apply.
- Errors clean on an unknown symbol/key (`SymbolNotFoundError` / `IndicatorNotFoundError`) or invalid inputs (`IndicatorError`).

## Acceptance criteria

Application (`IndicatorComputeService`, with fake repos + the default registry containing `sma`):

- [ ] On a watched crypto symbol with 5 stored candles and `compute('crypto:BTCUSDT', 'sma', { length: 3 }, '1h')`, returns the aligned 5-row state series with the first two rows `value: null` (warm-up) and rows 2–4 the closed-form SMA(3), inside `{ indicatorKey: 'sma', version: 1, period: '1h', state: [...] }` (full-payload `toEqual`, `closeTo` floats).
- [ ] When `range.from` lands **inside** the warm-up region, the returned slice starts at the first candle with a warm value — verified by computing-from-earliest then slicing, not by warming up from the requested `from`.
- [ ] `compute('unwatched-symbol', ...)` throws `SymbolNotFoundError`.
- [ ] `compute(symbolId, 'bogus', ...)` throws `IndicatorNotFoundError`.
- [ ] `compute(fxSymbol, 'vwma', ...)` throws `IndicatorError` (asset-class mismatch — `vwma.appliesTo` excludes FX).
- [ ] `compute(symbolId, 'sma', { length: 0 })` throws `IndicatorError` (input out of range).

Validator softening (`core`):

- [ ] `validateIndicatorInputs` accepts a numeric string for a Number input (`{ length: '14' }` → `{ length: 14 }`) — full-payload.
- [ ] `validateIndicatorInputs` still rejects a non-numeric string (`{ length: 'abc' }`) with `IndicatorError`.

API (`indicators.controller.ts`):

- [ ] `GET /symbols/:id/indicators/sma?period=1h&length=3&source=close` over a backfilled symbol → 200 with the result; **all-string query params** (including the numeric `length`) round-trip correctly.
- [ ] `GET …/sma?period=1h&from=…` slices the result so the first row's `time ≥ from`.
- [ ] Unknown symbol → 404; unknown indicator key → 404.
- [ ] Asset-class mismatch (FX symbol + `vwma`) → 400.
- [ ] Invalid `length=0` → 400.

CLI (`runIndicators ['compute', ...]`):

- [ ] `indicators compute <symbolId> sma --period 1h --inputs '{"length":3}'` prints the result; the embedded `state` round-trips through JSON.
- [ ] An unknown symbol throws `SymbolNotFoundError`.

## End-to-end expectation

`packages/api/tests/e2e/indicators.e2e.test.ts` (existing) **extended** with a compute pass over **real** Mongo + the real `defaultIndicators()` registry:

- Happy path: backfill a watched symbol → `GET /symbols/:id/indicators/sma?period=1h&length=3` returns the warm SMA series (full-payload `toEqual`, `closeTo` floats); `GET …/vwma?period=1h&multiplier=1&direction=both` returns the line + signal + confidence series with at least one firing signal bar (covers #13's enum-state round-tripping over HTTP).
- Critical failure mode: asset-class mismatch (an FX symbol with `vwma`) → **400** with `{ error }`.

This e2e closes the deferred coverage from #12 and #13 on the **compute/correctness** surface (the catalog/serialization side closed with #14).

## Out of scope

- Live/provisional computation on the forming candle (the live-chart layer) — that's #17.
- Persisting/caching results.
- A profile-scoped indicators compute route (`GET /profiles/:id/indicators/:instanceId/results`) — the client composes that from #15's instance lookup + this endpoint.
- Declared `warmup(inputs)` optimization (compute-from-earliest suffices for now).
- The monitoring loop and actions.

## Surprises

(Filled in retroactively if anything bites — empty by default.)
