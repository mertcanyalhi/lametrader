# Spec: indicator catalog — REST + CLI listing of available indicators

- Status: approved
- Touches:
  - `core` — `IndicatorNotFoundError` (sibling to `IndicatorError`), mapped to HTTP 404.
  - `api` — `controllers/indicators.controller.ts` (`GET /indicators` and `GET /indicators/:key`); `schemas/indicator.schema.ts` (TypeBox response shapes for the descriptors); `app.ts` registers the controller when `deps.indicators` is provided and the error handler maps `IndicatorNotFoundError` → 404; `app.types.ts` gains `indicators?: IndicatorRegistry`; `testing/app-deps.ts` wires `defaultIndicators()`; `main.ts` passes it through.
  - `cli` — `runIndicators` (`indicators list` + `indicators show <key>`); `index.ts` exports it; `bin.ts` wires the `indicators` command against `defaultIndicators()`.
  - READMEs — `api` and `cli` each gain an Indicators-resource section.

## Goal

Expose the registered indicators' **descriptors** (metadata only — no `compute`) so a UI and the CLI can enumerate available indicators and read each one's input/state schema.
This is the data a form renderer and (later) an action condition-builder consume.

## Domain model

`IndicatorNotFoundError` — distinct domain error so driving adapters map it to HTTP 404 (consistent with `SymbolNotFoundError`, `ProfileNotFoundError`).
Thrown by neither the registry's `get(key)` (which still returns `null`) nor by the engine, but by the **driving adapters** (controller / CLI) when their lookup misses — exactly the layer the 404 belongs to.

`IndicatorRegistry` is unchanged.
The controller and CLI both call `registry.list()` / `registry.get(key)` and serialize the resulting `IndicatorDefinition`s as JSON.

## API (RESTful)

- `GET /indicators` → **200** an array of every registered `IndicatorDefinition` (descriptors only).
- `GET /indicators/:key` → **200** the matching `IndicatorDefinition`; **404** with `{ error }` when no module is registered for that key.

The `/indicators` resource is registered when `AppDependencies.indicators` is provided, matching the pattern of the other optional controllers.

## CLI

`lametrader indicators <subcommand>`:

- **`list`** — print every registered definition as JSON.
- **`show <key>`** — print the matching definition as JSON; an unknown key throws (`bin.ts`'s `try/catch` prints the error and exits non-zero, matching `symbols` / `config` / `candles`).

## Acceptance criteria

API (`api/controllers/indicators.controller.ts`):

- [ ] `GET /indicators` returns **200** with the full array of registered definitions — including the moving-average (`sma`) and VWMA (`vwma`) reference modules — each serialized verbatim with `key`, `name`, `description`, `version`, `appliesTo`, `inputs`, `state` (full-payload `toEqual`, no functions leak).
- [ ] `GET /indicators/sma` returns **200** with the moving-average definition (full-payload, identical to the value `defaultIndicators().get('sma')!.definition`).
- [ ] `GET /indicators/unknown-key` returns **404** with `{ error: '<reason>' }`.

CLI (`cli/runIndicators`, against a real `defaultIndicators()` registry):

- [ ] `runIndicators(['list'], registry)` prints the full set of definitions as JSON (parseable, matches `registry.list()` full-payload).
- [ ] `runIndicators(['show', 'sma'], registry)` prints the matching definition as JSON (full-payload).
- [ ] `runIndicators(['show', 'unknown-key'], registry)` throws `IndicatorNotFoundError`.
- [ ] `runIndicators(['bogus'], registry)` throws on an unknown subcommand.

Error mapping (`api/app.ts`):

- [ ] The app's error handler maps `IndicatorNotFoundError` → 404 with the uniform `{ error }` body — verified by the route-level AC above.

## End-to-end expectation

API e2e over real Mongo (Testcontainers), exercising the full HTTP surface against the real `defaultIndicators()` registry:

- Happy path: `GET /indicators` → 200, response asserts **both** reference indicators (`sma` and `vwma`) including their full descriptor shape — inputs, state, `appliesTo` — round-tripping the registry over real HTTP.
  `GET /indicators/sma` and `GET /indicators/vwma` each return their definition.
- Critical failure mode: `GET /indicators/unknown-key` → 404 with `{ error: <reason> }`.

This e2e closes the deferred coverage from #12 and #13 on the **catalog / serialization** surface (the compute / correctness side closes with #16).

## Out of scope

- Computing an indicator over a symbol's stored candles (`GET /symbols/:id/indicators/:key`) — that's #16.
- Chart rendering of the display hints.
- Attaching indicators to profiles — that's #15.
- The action-condition grammar that addresses indicator state by key.
- Localizing labels / option labels in catalog responses.

## Surprises

(Filled in retroactively if anything bites — empty by default.)
