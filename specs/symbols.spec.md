# Spec: symbols — discovery, add/remove, per-symbol periods

- Status: approved
- Touches: `core` (`Instrument`/`WatchedSymbol` entities, `SymbolType` enum,
  `MarketDataSource` + `WatchlistRepository` ports, validation), `engine`
  (`SymbolService` use-case, `BinanceMarketDataSource` + `YahooMarketDataSource`
  driven adapters, `MongoWatchlistRepository`), `cli` + `api` (driving adapters to
  discover/add/remove/list and change a symbol's periods).

## Goal

Let users **discover** tradeable symbols (crypto, stocks, funds, FX), **add** them
to a persisted watchlist (validating the symbol actually exists at its source),
**remove** them, and set **per-symbol periods** (which timeframes we will later
backfill/poll for that symbol). This is the foundation that backfill (slice 2) and
continuous polling (slice 3) build on. No price data is fetched/stored here.

## Domain model

- `SymbolType` is an **enum**: `CRYPTO, STOCK, FUND, FX`.
- Canonical id = `"<type>:<ticker>"`, ticker = the source-native symbol with no
  slashes, e.g. `crypto:BTCUSDT`, `stock:AAPL`, `fund:SPY`, `fx:EURUSD`. The type
  prefix routes the id to the owning source.
- `Instrument = { id, type, description, exchange, currency? }` — a discovered
  instrument. (Named `Instrument`, not `Symbol`, to avoid shadowing the JS global
  `Symbol`.)
  - `exchange` (required) — venue/exchange, e.g. `"Binance"`, `"NMS"`. Both sources
    report it on search and lookup.
  - `currency` (optional) — pricing currency, e.g. `"USDT"`, `"USD"`. Binance always
    reports it (quote asset); Yahoo only on `lookup` (a per-symbol quote), so Yahoo
    *search* results omit it. A watched symbol (added via lookup) therefore always
    has it.
- `WatchedSymbol = Instrument & { periods: Period[] }` — a persisted watchlist entry.
- **Periods** reuse the existing `Period` enum. A symbol's `periods` must be a
  non-empty, duplicate-free **subset of the global config's `periods`** (the
  platform-supported set). On add, `periods` defaults to the global config's
  `periods`.
- A symbol is **per-id singleton** in the watchlist (adding an existing id replaces).

## Ports (driven, defined in `core`)

- `MarketDataSource`: `readonly types: SymbolType[]`; `search(query): Promise<Instrument[]>`;
  `lookup(id): Promise<Instrument | null>` (existence check). One per provider.
- `WatchlistRepository`: `list()`, `get(id)`, `add(WatchedSymbol)`, `remove(id)`.

## Errors

- `SymbolError` — validation failure (bad/empty/duplicate/unsupported period, no
  source for type). Maps to **400**.
- `SymbolNotFoundError` — the symbol doesn't exist at its source, or isn't in the
  watchlist. Maps to **404**.
- `SymbolConflictError` — the symbol is already on the watchlist. Maps to **409**.
  Re-adding never mutates the existing entry (its periods are preserved); use
  `PATCH` to change periods.

## Acceptance criteria (each → one unit test, full-payload `toEqual`)

Domain (`core`):

- [ ] `symbolType("crypto:BTCUSDT")` returns `SymbolType.Crypto`.
- [ ] `symbolType` throws `SymbolError` on a missing/unknown type prefix (e.g. `"AAPL"`, `"bond:US10Y"`).
- [ ] `parseSymbolPeriods(["1h","1d"], supported)` returns `[Period.OneHour, Period.OneDay]`.
- [ ] `parseSymbolPeriods` throws `SymbolError` on an empty list.
- [ ] `parseSymbolPeriods` throws on a duplicate period.
- [ ] `parseSymbolPeriods` throws on an unsupported (non-enum) period string (e.g. `"2h"`).
- [ ] `parseSymbolPeriods` throws on a valid period that is **not** in `supported` (not platform-enabled).

Application (`engine`, against fake `MarketDataSource`s + fake `WatchlistRepository` + a `ConfigService`):

- [ ] `discover(query)` fans out to every source and returns the merged `Instrument[]`.
- [ ] `discover(query, type)` queries only the source serving that type.
- [ ] `discover(type)` throws `SymbolError` when no registered source serves the type.
- [ ] `add(id)` validates existence via the owning source and persists a `WatchedSymbol` whose `periods` default to the config's `periods`; returns it.
- [ ] `add(id, periods)` persists with the given (valid subset) periods.
- [ ] `add` throws `SymbolNotFoundError` and persists nothing when the source returns `null` for the id.
- [ ] `add` throws `SymbolError` and persists nothing when `periods` contains a period not in the config.
- [ ] `add` throws `SymbolConflictError` and leaves the existing entry (incl. periods) unchanged when the id is already watched.
- [ ] a watched symbol carries the `exchange` (and `currency` when the source reports it) from the source lookup.
- [ ] `list()` returns the persisted watched symbols.
- [ ] `remove(id)` deletes the symbol from the watchlist.
- [ ] `setPeriods(id, periods)` updates and returns the symbol; throws `SymbolNotFoundError` when the id isn't watched.

Port contract (one shared suite, run against the fake in unit and the real adapters in `*.live.test.ts`):

- [ ] `search(query)` returns only symbols whose `type` ∈ the source's `types`.
- [ ] `lookup` returns the `Symbol` for an existing id and `null` for a bogus one.

Driving adapters:

- [ ] CLI `symbols discover <query> [--type <t>]` prints discovered symbols as JSON.
- [ ] CLI `symbols add <id> [--periods 1h,1d]` persists and echoes the watched symbol.
- [ ] CLI `symbols list` prints the watchlist as JSON.
- [ ] CLI `symbols remove <id>` removes it.
- [ ] CLI `symbols set-periods <id> --periods 1h,1d` updates and echoes.
- [ ] API `GET /instruments?q=&type=` → 200 with discovered symbols.
- [ ] API `POST /symbols` `{ id, periods? }`: valid → 201 watched symbol; nonexistent id → 404; period not supported → 400; already watched → 409.
- [ ] API `GET /symbols` → 200 with the watchlist.
- [ ] API `DELETE /symbols/{id}` → 204.
- [ ] API `PATCH /symbols/{id}` `{ periods }` → 200 updated; not watched → 404; invalid → 400.

## End-to-end expectation

API e2e over **real Mongo** (Testcontainers) with a **stub `MarketDataSource`** (so
the feature wiring — discover → validate → persist → list → update → remove — is
exercised end-to-end over HTTP without depending on a third-party API in CI):

- Happy path: `POST /symbols` a stub-known id → 201; `GET /symbols` shows it with
  default periods; `PATCH` its periods → 200; `DELETE` → 204; `GET` is empty.
- Critical failure mode: `POST /symbols` a stub-**unknown** id → 404 and nothing is
  persisted.

The real Binance/Yahoo adapters are covered by the shared port-contract suite in the
`live` tier (`*.live.test.ts`), against the real external APIs.

## Out of scope (later slices / not now)

- Fetching, backfilling, or storing any price/candle data (slice 2).
- Continuous polling and WS streaming (slice 3).
- Bonds (no reliable free, deep-history source).
- Per-user watchlists, auth, paging/ranking of discovery results, exchange/venue
  metadata beyond `type`, and editing a symbol's id (remove + re-add instead).
