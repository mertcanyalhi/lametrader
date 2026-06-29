# Spec: rules-v2 REST API (`/v2/rules*`)

- Status: draft
- Touches: `RulesV2.RuleRepository` / `RulesV2.EventLog` ports (driven); v2 application use-case `RuleServiceV2` (new); v2 wire helper `wireRuleEngineV2` (new); driving HTTP adapter `rulesV2Controller` (new), `app.ts` wiring + global error handler.

## Goal

Expose v2 rules over a REST surface mounted at `/v2/rules` so the v2 engine is reachable from the API.
Adds a v2 application service (`RuleServiceV2`) over the existing v2 ports, a `wireRuleEngineV2` analogue that plugs the v2 orchestrator into the live event chain alongside v1, and a Fastify controller with TypeBox-validated payloads.
Per ADR 0016 the two engines coexist behind a feature flag until cutover.

## Acceptance criteria

Each bullet maps to exactly one test.

### RuleServiceV2 (engine use-case)

- [ ] `list()` with no filter returns every persisted rule, sorted by `order` ascending.
- [ ] `list({ profileId })` returns only rules whose `profileId` matches, sorted by `order`.
- [ ] `list({ symbolId })` returns Symbol-scoped rules whose `scope.symbolId` matches, Symbols-scoped rules whose `scope.symbolIds` includes the id, every AllSymbols-scoped rule, sorted by `order`.
- [ ] `list({ enabled })` returns only rules whose `enabled` flag matches.
- [ ] `list({ profileId, symbolId, enabled })` ANDs all three filters.
- [ ] `get(id)` returns the rule when present, throws `RuleNotFoundError` when not.
- [ ] `create(input)` generates `id` / `createdAt` / `updatedAt` from injected `newId` / `now`, persists via the repository, returns the assembled rule.
- [ ] `create(input)` with a tick-cadence trigger (`EveryTime` / `Once` / `OncePerBar`) on a `Symbol`-scoped unwatched symbol rejects with a `TickRuleNotEligibleError` and does NOT persist.
- [ ] `create(input)` with a tick-cadence trigger on a `Symbols`-scoped rule where any referenced symbol is unwatched rejects with `TickRuleNotEligibleError` listing every unwatched symbol id.
- [ ] `create(input)` with a tick-cadence trigger on an `AllSymbols`-scoped rule is allowed regardless of which symbols are currently watched (fan-out is dynamic at fire-time).
- [ ] `create(input)` with a bar-cadence (`OncePerBarOpen` / `OncePerBarClose`) or periodic (`OncePerInterval`) trigger does NOT consult the watchlist.
- [ ] `patch(id, partial)` merges the partial into the existing rule, re-runs validation + tick-gate on the merged result, bumps `updatedAt`, persists.
- [ ] `patch(id, partial)` throws `RuleNotFoundError` when the id is unknown.
- [ ] `remove(id)` deletes the rule when present, throws `RuleNotFoundError` when not.
- [ ] `listEvents(id)` returns the rule's events newest-first; `listSymbolEvents(symbolId)` returns the symbol's mirrored events newest-first.

### REST surface (controller + schema)

- [ ] `POST /v2/rules` with a valid body returns `201` and the assembled rule.
- [ ] `POST /v2/rules` with a body that fails schema (e.g. missing `scope`, wrong action `kind`, bad `expiration` shape) returns `400` with `{ error, fields: [{ path, message }, ...] }` where every offending field is listed.
- [ ] `POST /v2/rules` with a tick-cadence trigger on an unwatched symbol returns `400` with one `fields[]` entry whose `path` points at `scope.symbolId` (or `scope.symbolIds`).
- [ ] `GET /v2/rules` returns `200` and the rule list; `?profileId` / `?symbolId` / `?enabled` filter it.
- [ ] `GET /v2/rules/:id` returns `200` and the rule when present, `404` `{ error }` when not.
- [ ] `PATCH /v2/rules/:id` with a valid partial body returns `200` and the updated rule; invalid → `400`; missing → `404`.
- [ ] `DELETE /v2/rules/:id` returns `204` when present, `404` when not.
- [ ] `GET /v2/rules/:id/events` returns `200` and the rule's events log newest-first; supports `?limit` (default 50, max 500) and `?before` (epoch-ms cursor); `404` when the rule is missing.
- [ ] `GET /v2/symbols/:id/rule-events` returns `200` and the symbol's mirrored events log newest-first; same pagination.

### Global error handler

- [ ] The Fastify error handler, on any error with a `validation` array, replies `400 { error: <summary>, fields: [{ path, message }, ...] }` where `path` is the JSON-pointer-style path (no leading `/`, dotted) into the request body and every entry mirrors one AJV failure.
  (Additive: v1 consumers still read `error`; the new `fields` is opt-in.)

### Live wiring

- [ ] `wireRuleEngineV2(deps)` constructs the v2 orchestrator over the v2 repos + event log + ActionRunner + TriggerDispatcher + bridges (`tickBridge`, `barBridge`, `indicatorBridge`) plus a `drain()` per the v1 analogue.
- [ ] `connectServices()` constructs `MongoRuleRepository` (v2) + `MongoEventLog` (v2) + `RuleServiceV2` and exposes them on the returned bundle so the API layer can register the v2 controller.

## End-to-end expectation

The single happy path the e2e test asserts:

1. Spin Mongo via testcontainers; call `connectServices()` (both engines wired).
2. Watch a symbol via the existing watchlist API.
3. `POST /v2/rules` with a tick-cadence `EveryTime` rule scoped to that symbol with a `Price > 100` condition and a `SetSymbolState` action — expect `201`.
4. Drive a `TickEvent` (price 101) through the v2 quote bridge.
5. `GET /v2/rules/:id/events` returns one `Fired` entry; `GET /v2/symbols/:id/rule-events` mirrors it.

The one critical failure mode the e2e covers:

- `POST /v2/rules` with a tick-cadence trigger on an unwatched symbol rejects `400` with `fields: [{ path: 'scope.symbolId', ... }]`; the rule is NOT persisted (a follow-up `GET /v2/rules` does not return it).

## Out of scope

- A `/v2/rules/order` reorder endpoint (the issue does not list one; defer until UI surfaces a need).
- A `tickEnabled` per-watchlist-entry flag (watchlist membership is the gate this iteration).
- Long-lived per-symbol quote-stream subscriptions independent of WebSocket clients (tick events still arrive via the existing transient quote-stream service; rules just need a watched symbol to be eligible).
- OHLCV / indicator-series resolution in `LiveEvaluationLookupsV2` beyond the per-symbol cache the bridges seed; the spec for "Price > 100" only needs the tick price, which the orchestrator reads off the event.
  // Lazy: ceiling is "scalar lookups derived from the latest observed candle / indicator state per symbol".
  Upgrade path: hand the lookups a `CandleRepository` + per-period bar series view + an `IndicatorSeriesStore` reference so series-aware operators (Crossing, Channel, Moving) work end-to-end.
- v1 → v2 migration of existing rules (cutover is manual per ADR 0016 #12).
- Web UI for v2 rules (separate issue #396).

## Surprises

(Filled in retroactively if anything bites.)
