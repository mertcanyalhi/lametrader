# Context modules replace per-resource modules

- Status: accepted
- Amends: 0018

## Context

ADR-0018 collapsed the hexagon into a NestJS monolith with one feature module per resource.
Eighteen module directories now sit flat under `packages/backend/src/`, and the real coupling does not respect those boundaries: the heaviest `imports:` edges cluster tightly (candles↔symbols↔watchlist↔market-data; rules↔indicators↔profiles↔state; stream↔stream-hubs↔event-log), so `AppModule` carries a dozen imports and the modules carry dozens of inter-module edges to express what are really a few bounded contexts.
The per-resource granularity buys isolation the code does not use — no resource is deployed, versioned, or reasoned about alone — while the flat spread makes the context boundaries invisible.

The leftover `domain/` directory (a flat grab-bag of ~20 type/pure-function files reached into by 13 modules) is the same problem seen from the type side: a shared ring that no module owns.

## Decision

Group the backend into **four context modules**, each grouping its internal files by technical role.

- **`CommonModule`** — infra and cross-cutting: the root Mongo connection, `nestjs-pino` logging, health, the `DomainExceptionFilter` / `ValidationPipe` glue.
  (absorbs `mongo`, `logging`, `health`, `common`)
- **`MarketModule`** — instruments and their price data: instrument/symbol resolution, market-data source adapters, the candle store, the watchlist store.
  (absorbs `symbols`, `market-data`, `candles`, `watchlist`)
- **`AnalyticsModule`** — signals derived from market data: the indicator registry, profiles, the rule engine + rule store, the state store.
  (absorbs `indicators`, `profiles`, `rules`, `state`)
- **`DeliveryModule`** — outbound surfaces and runtime settings: the multiplexed `/stream` WS + hubs, telegram notifications, the event log, the `/config` settings feature.
  (absorbs `stream`, `stream-hubs`, `notifications`, `event-log`, `config`)

The dependency direction is `Delivery → Analytics → Market → Common` (plus `Delivery → Market`).
Most former inter-module edges become intra-module DI; `AppModule` imports four modules.

The former `runtime` module is not a context: its `LiveCascadeService` injects producers from Market, Analytics, and Delivery, so it cannot live in the leaf `CommonModule` without reversing the `→ Common` arrow.
It relocates to the composition root — an `AppModule`-level provider that `main.ts` resolves after `listen()`, exactly as the old `connectServices` root did.

Two ADR-0018 conventions are amended to make this legal:

1. **One-model-per-module is relaxed.**
   A context module registers every Mongoose model its context owns via `MongooseModule.forFeature([...])` and binds every repository token its context owns (`CANDLE_REPOSITORY` + `WATCHLIST_REPOSITORY` in `MarketModule`; `RULE_REPOSITORY` + `STATE_REPOSITORY` in `AnalyticsModule`; `EVENT_LOG` in `DeliveryModule`).
   The shared-store discipline is unchanged in substance — one binding per store, exported once — only the module that hosts it is now the context, not the resource.

2. **Internal files are grouped by technical role, not by resource.**
   Within each module: `controllers/`, `services/`, `interfaces/` (repository/provider token interfaces + types migrated from the old `domain/`), `dto/`, `persistence/` (Mongoose schema + its repository adapter), and `domain/` for the pure functions migrated from the old top-level `domain/`.
   The old top-level `src/domain/` is dissolved into the owning context's `interfaces/` and `domain/` folders — no file lands in two contexts.

## Considered Options

- **Keep per-resource modules, flatten nothing** — the status quo; rejected because the boundaries the modules assert are not the boundaries the code has.
- **Group internal files by sub-feature** (`market/candles/`, `market/symbols/`) — keeps each resource as a unit but reproduces the per-resource split one level down, defeating the consolidation; rejected in favor of role-based grouping.
- **Three modules** (fold Delivery into Analytics) — mixes outbound transport with signal computation; rejected for keeping delivery a distinct context.
- **`CommonModule` absorbs the `config` feature** — rejected: `config/` is a user-facing HTTP feature (two controllers), not cross-cutting infra; only the already-global `@nestjs/config` env layer is common, and it needs no move.

## Consequences

- The acyclic module graph is preserved and simplified; no `forwardRef` is introduced (none exists today).
- The four modules are large; role-based internal folders are what keep them navigable — a flat 60-file module directory would be worse than the spread it replaces.
- Role-based grouping means a single resource's files are split across `controllers/`/`services/`/`persistence/`; the module boundary, not the folder, is now the unit of cohesion.
- CLAUDE.md's "one module per resource", "shared-persistence-module (one model + one token)", and "adding to the backend" sections are rewritten to describe context modules and role-based internal layout.
- ADR-0018's decision stands (NestJS monolith, feature-module grain, DI-by-token, one HTTP contract); only its resource-granularity and one-model-per-module conventions are amended here.
