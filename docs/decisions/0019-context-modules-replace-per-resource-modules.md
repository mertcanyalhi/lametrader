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

- **`CommonModule`** — the infra leaf every context depends on: the root Mongo connection, `nestjs-pino` logging, health, the `DomainExceptionFilter` / `ValidationPipe` glue, plus the shared leaves that sit *below* more than one feature context — the `/config` settings feature (Market and Delivery both read it), the `event-log` store (Analytics and Delivery), the four `stream-hubs` (Market and Analytics publish, Delivery consumes), and telegram `notifications` (the rule engine sends it).
  (absorbs `mongo`, `logging`, `health`, `common`, `config`, `event-log`, `stream-hubs`, `notifications`)
- **`MarketModule`** — instruments and their price data: instrument/symbol resolution, market-data source adapters, the candle store, the watchlist store.
  (absorbs `symbols`, `market-data`, `candles`, `watchlist`)
- **`AnalyticsModule`** — signals derived from market data: the indicator registry, profiles, the rule engine + rule store, the state store.
  (absorbs `indicators`, `profiles`, `rules`, `state`)
- **`DeliveryModule`** — the outbound surface: the multiplexed `/stream` WS gateway.
  (absorbs `stream`)

The dependency direction is `Delivery → Analytics → Market → Common`.
Most former inter-module edges become intra-module DI; `AppModule` imports four modules.

One reverse edge is irreducible: `SymbolService` (Market) injects `ProfileService` (Analytics) for the remove-symbol → profile-prune cascade, while Analytics depends on Market the other way (`indicators→candles`, `state→symbols`, `rules→candles/symbols`).
`MarketModule` and `AnalyticsModule` therefore import each other through `forwardRef`, the single accepted deviation from ADR-0018's "no indirection that doesn't pay for itself".
The alternative — inverting the cascade into a symbol-removed event Analytics subscribes to — is a behavioral change deferred as out of scope for a structural regrouping.
Folding the shared leaves into `CommonModule` is what dissolves the *other* candidate cycles (`rules→notifications` and the `config`/`event-log`/`stream-hubs` fan-in), leaving this one.

The former `runtime` module is not a context: its `LiveCascadeService` injects producers from Market, Analytics, and Delivery, so it cannot live in the leaf `CommonModule` without reversing the `→ Common` arrow.
It relocates to the composition root — an `AppModule`-level provider that `main.ts` resolves after `listen()`, exactly as the old `connectServices` root did.

Two ADR-0018 conventions are amended to make this legal:

1. **One-model-per-module is relaxed.**
   A context module registers every Mongoose model its context owns via `MongooseModule.forFeature([...])` and binds every repository token its context owns (`CANDLE_REPOSITORY` + `WATCHLIST_REPOSITORY` in `MarketModule`; `RULE_REPOSITORY` + `STATE_REPOSITORY` in `AnalyticsModule`; `EVENT_LOG` and the config store in `CommonModule`).
   The shared-store discipline is unchanged in substance — one binding per store, exported once — only the module that hosts it is now the context, not the resource.

2. **Internal files are grouped by technical role, not by resource.**
   Within each module: `controllers/`, `services/`, `interfaces/` (repository/provider token interfaces + types migrated from the old `domain/`), `dto/`, `persistence/` (Mongoose schema + its repository adapter), and `domain/` for the pure functions migrated from the old top-level `domain/`.
   The old top-level `src/domain/` is dissolved into the owning context's `interfaces/` and `domain/` folders — no file lands in two contexts.

## Considered Options

- **Keep per-resource modules, flatten nothing** — the status quo; rejected because the boundaries the modules assert are not the boundaries the code has.
- **Group internal files by sub-feature** (`market/candles/`, `market/symbols/`) — keeps each resource as a unit but reproduces the per-resource split one level down, defeating the consolidation; rejected in favor of role-based grouping.
- **Three modules** (merge Market + Analytics into one `DomainModule`) — the honest response to the `symbols↔profiles` cycle, since it becomes intra-module DI with no `forwardRef`; rejected to keep the two domains legible as separate contexts, accepting one `forwardRef` as the price.
- **Keep `config`/`notifications` as their own thin feature modules** — cleaner semantics (a controllered feature is not "common"), but adds two modules over the minimum and re-introduces the cross-context fan-in that folding them into the leaf removes; rejected for the lower count.
- **Group internal files by sub-feature** — reproduces the per-resource split one level down; rejected in favor of role-based grouping.

## Consequences

- The module graph is acyclic except for the single documented `forwardRef` between `MarketModule` and `AnalyticsModule`; every other former cross-context cycle is dissolved by folding the shared leaves into `CommonModule`.
- `CommonModule` is broader than pure infra — it hosts two controllered leaf features (`/config`, `/config/notifications/telegram`). This is the accepted cost of keeping them below the contexts that depend on them without a separate module each.
- The four modules are large; role-based internal folders are what keep them navigable — a flat 60-file module directory would be worse than the spread it replaces.
- Role-based grouping means a single resource's files are split across `controllers/`/`services/`/`persistence/`; the module boundary, not the folder, is now the unit of cohesion.
- CLAUDE.md's "one module per resource", "shared-persistence-module (one model + one token)", and "adding to the backend" sections are rewritten to describe context modules and role-based internal layout.
- ADR-0018's decision stands (NestJS monolith, feature-module grain, DI-by-token, one HTTP contract); only its resource-granularity and one-model-per-module conventions are amended here.
