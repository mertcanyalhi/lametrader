# Indicator contract: explicit composition over a self-registering registry

- Status: accepted

## Context

Issue #12 established the indicator contract — typed input/state descriptors with type-level inference, an `IndicatorRegistry`, and a `defineIndicator` helper — and called for `defineIndicator` to **self-register** modules into a static registry.
The motivation: an indicator file `import './sma.js'` would be enough to make it available, mirroring Pine-style author ergonomics.

Two forces pushed back on the self-register design once the implementation was on the table:

1. **The existing pattern in the codebase is explicit composition.**
   `defaultMarketDataSources()` in `engine/src/symbols/default-sources.ts` builds the array of `MarketDataSource`s and returns it; the composition root passes it where needed.
   A self-registering registry would have introduced a second architectural shape (module-level mutable state) for the same shape of problem (a set of pluggable modules), forcing future readers to learn two patterns instead of one.

2. **Testability cost.**
   A module-level singleton needs careful reset between unit tests, and adding/removing modules per test requires reaching into global mutation.
   With DI-passed registries, every focused test constructs an empty `IndicatorRegistry` and registers just what it exercises.

## Decision

`defineIndicator(spec)` is a **pure factory**: it constructs an `IndicatorModule` (defaulting `appliesTo` to every `SymbolType` when omitted) and returns it.
It does **not** push into a module-level registry.

Registration is **explicit** via two surfaces:

- `IndicatorRegistry` instance methods — `register`, `list`, `get` — with no module-level singleton.
- `defaultIndicators(): IndicatorRegistry` — a pure factory that instantiates an empty registry, calls `register` for each shipped module, and returns it.
  Mirrors `defaultMarketDataSources()`.
  Adding a new indicator is a one-line edit to this file alongside the indicator's own source file.

Downstream consumers (the catalog API in #14, the compute service in #16, the live stream in #17) receive the registry via dependency injection — no global lookup.

## Consequences

- One architectural shape for "a set of pluggable modules": the same factory-and-DI pattern as market-data sources.
  Future readers learn it once.
- Trivial test isolation — `new IndicatorRegistry()` gives a clean slate, and tests register exactly the modules they need.
- Adding a new indicator costs **two** one-line edits (the module file itself, and one `register()` call in `defaultIndicators()`), not one as the self-register design would have given.
  Accepted as the cost of avoiding global state and matching the rest of the codebase.
- The literal AC text in #12 — "`defineIndicator` registers the module" — is **not** honored as written.
  The functional behaviours the AC names — `IndicatorRegistry.list()` / `get(key)` round-trip; unknown key returns `null` — are honored.
  This ADR is the durable record of the deviation; the spec for #12 (`specs/indicator-contract.spec.md`) was updated to match before implementation landed (merged in PR #20).
- This ADR also closes the workflow gap in #12, which explicitly asked for "an ADR for the contract + registry shape (a non-obvious decision)" but wasn't written at the time.
