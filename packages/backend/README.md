# @lametrader/backend

The backend monolith — an idiomatic [NestJS](https://nestjs.com) application on the Express platform.

This package is **the platform's backend** — the product of the NestJS migration (see `specs/nestjs-monolith-migration.spec.md` and ADR-0018), and the only deployed API since the cutover retired the old Fastify `api` package.
On top of the cross-cutting shell (validated configuration, structured logging, the root Mongo connection, a health endpoint) it serves the whole HTTP + WebSocket surface — **config + Telegram notifications**, **symbols + instruments**, **profiles** (with attached indicators), **candles + backfill** (reads, the async backfill job, and its per-job progress WebSocket), **state + state history**, **indicators**, **rules + the live rule engine**, and the multiplexed **`/stream`** live WebSocket — all behind one app-wide HTTP contract.
On boot it also runs the continuous market-data **poll loop** that drives the live streams and rule evaluation: `main.ts` starts the runtime activation once the server is listening (see **Runtime** below), the parity of the old `api/main.ts` `polling.start()` after `listen`.

## What's here

- **Bootstrap** (`src/main.ts`, `src/app.module.ts`) — boots a Nest app on Express, mounts the OpenAPI docs, and wires the global error filter + validation pipe.
- **Env config** (`src/config/env.validation.ts`, `app-config.types.ts`) — `@nestjs/config` with a `validate` hook (`validateEnv`) that resolves and validates the environment into a typed `AppConfig`.
  Same variables, defaults, and fail-fast behavior as the previous `packages/engine/src/settings.ts` (`loadSettings`).
- **Config resource** (`src/config`) — the `ConfigModule`: `ConfigService` over a Mongoose-backed key-value store (`config` collection), behind the `/config` controller.
- **Notifications** (`src/common`) — `NotificationConfigsService` (generic notification-config CRUD, stored in the same config K/V store) and `TelegramNotifier` (Bot API sender), behind the `/config/notifications` controller.
- **Symbols** (`src/symbols`) — the `SymbolsModule`: `SymbolService` over a Mongoose-backed watchlist (`watchlist` collection) and the market-data sources, behind the `/instruments` + `/symbols` controller.
  It imports the `ProfilesModule` and injects its `ProfileService` as the symbol-removal → profile-prune cascade (ADR-0009): removing a symbol prunes it from every profile's `symbols` scope.
- **Profiles** (`src/profiles`) — the `ProfilesModule`: `ProfileService` over a Mongoose-backed profile store (`profiles` collection), behind the `/profiles` controller (CRUD + the attached-indicators sub-resource). Validates a `symbols` scope against the watchlist and attached-indicator inputs against the indicator registry.
- **Candles** (`src/candles`) — the `CandlesModule`: the single owner of the Mongoose-backed candle store (`candles` collection), binding and exporting the `CANDLE_REPOSITORY` token (the shared-persistence pattern; the symbols use-case imports it for quote enrichment + the remove cascade). It drives the `BackfillService` (reads) and `BackfillJobService` (async jobs) behind the `/symbols/:id/candles` + `/backfill` controller, and serves the per-job progress WebSocket via the `BackfillProgressGateway` (a raw `ws` server on the HTTP upgrade, matching the param'd URL).
- **State** (`src/state`) — the `StateModule`: the single owner of the Mongoose-backed rule-engine state store (`state` collection), binding and exporting the `STATE_REPOSITORY` token (the shared-persistence pattern; per-`profileId` partitioning + the tagged-union `StateValue` round-trip preserved). It drives the read-side state controller (`GET /profiles/:profileId/state/global`, `GET /symbols/:id/state`) and the chart state-overlay routes (`GET /symbols/:id/state-keys`, `GET /symbols/:id/state/:key/series`) via the relocated `StateHistoryService`, which reads a symbol's mirrored rule events off the `watchlist` document's embedded `events` array. It imports the shared `WatchlistModule` for the watched-symbol 404 guard.
- **Indicators** (`src/indicators`) — the `IndicatorsModule`: the shared, read-only `IndicatorRegistry` (catalog of the shipped `sma` / `vwma` modules, pure logic) built by `defaultIndicators` and exported for the profiles use-case to validate against. It drives the indicators controller — the read-only catalog (`GET /indicators`, `GET /indicators/:key`) straight off the registry, and the ad-hoc compute route (`GET /symbols/:id/indicators/:key`) over the relocated `IndicatorService` (explicit-composition contract kept as-is, ADR-0010). Compute reads a symbol's stored candles and guards on the watchlist, so this module imports the shared `CandlesModule` (`CANDLE_REPOSITORY`) and `WatchlistModule` (`WATCHLIST_REPOSITORY`).
- **Event log** (`src/event-log`) — the `EventLogModule`: the single owner of the mirrored rule-event log (ADR-0014), binding and exporting the full `EVENT_LOG` port (a Mongoose adapter over the `rules` and `watchlist` documents' embedded `events` arrays) and the narrow `SYMBOL_EVENT_LOG` read port aliased onto it. The state resource's `StateHistoryService` consumes the narrow port; the rules resource appends and reads through the full one.
- **Rules** (`src/rules`) — the `RulesModule`: the single owner of the Mongoose-backed rule store (`rules` collection), binding and exporting the `RULE_REPOSITORY` token (the greenfield v2 rule-shape round-trip preserved, ADR-0016). It drives the `/rules` CRUD controller plus the chart-facing event reads (`/rules/:id/events`, `/symbols/:id/rule-events[/count]`) over the relocated `RuleService`, and hosts the whole relocated rule engine (orchestrator, dispatcher, action runner, bridges, operators, evaluation context) behind a `RuleEngineService` — constructed idle in the module (every collaborator injected, nothing composed), then composed + started by the runtime activation (`LiveCascadeService`, from `main.ts` after `listen`), which also feeds it each polled candle and indicator-state event.
- **Stream** (`src/stream`) — the `StreamModule`: the multiplexed `GET (WS) /stream` gateway carrying candle / indicator / quote / rule-event subscriptions on one socket. Like the backfill-progress gateway it drives a raw `ws` server on the HTTP `upgrade`, matching **only** `/stream` (ignoring every other upgrade) so both raw-`ws` gateways coexist on the one server. It hosts the relocated `SubscriptionRegistry` + the four subscription kinds + the relocated `QuoteStreamService`, and completes the producer→hub topology — `PollingService.onCandle`, `IndicatorService.onState`, `QuoteStreamService.onQuote`, and the event log's symbol-side `onAppend` (via a `RuleEventStreamBridge`) publish to four shared `StreamHub`s in a dependency-free `StreamHubsModule` that the gateway subscribes to. The runtime activation (`LiveCascadeService`) drives every producer: the poll loop fans each candle into the indicator, quote, and rule-engine producers, which publish onto their hubs.
- **Market data** (`src/market-data`) — the `MarketDataModule`: the registered discovery sources (Binance for crypto, Yahoo for stocks/funds/FX) bound to the `MARKET_DATA_SOURCES` token, fanned out by the symbols use-case, backfill, and the poll loop.
- **Runtime** (`src/runtime`) — the `RuntimeModule` + `LiveCascadeService`: the activation seam that turns the relocated-but-idle producers live. Sitting above every producer module, it injects the `PollingService`, `IndicatorService`, `QuoteStreamService`, and `RuleEngineService`, and on `start()` composes the rule engine and wires the fan-out the old engine `connectServices` did — each polled candle feeds `IndicatorService.handleCandle` (→ indicator hub), `QuoteStreamService.handleCandle` (→ quote hub), and the rule engine (→ rule-event hub + notifications) on top of the candle hub, and each recomputed indicator state feeds the rule engine's indicator bridge. `main.ts` calls `start()` only **after** the server is listening, so the app the e2e suites build via `Test.createTestingModule` never starts a live loop; `enableShutdownHooks()` routes SIGINT/SIGTERM through `app.close()`, which stops the loop and closes Mongo.
- **HTTP contract** (`src/common`) — the keystone the whole API reuses: a global `DomainExceptionFilter` mapping domain errors to status codes with the uniform `{ error, fields? }` envelope, and a global `ValidationPipe` (class-validator DTOs) emitting the same envelope on validation failure.
- **Logging** (`src/logging`) — [`nestjs-pino`](https://github.com/iamolegga/nestjs-pino) for request and application logging.
  The root level comes from `LOG_LEVEL`; records carry an `{ app: 'server' }` base field; modules take a scoped child logger by injecting `PinoLogger` and calling `setContext(scope)` (the pino twin of the engine's `getLogger(scope)`).
- **Mongo** (`src/mongo`) — `@nestjs/mongoose` opening the root connection from `MONGODB_URI`; feature modules register their own schemas with `MongooseModule.forFeature`.
- **Health** (`src/health`) — `GET /health` → `200 { "status": "ok" }`.

## Endpoints

| Method   | Path                                        | Body                           | Description                                              |
| -------- | ------------------------------------------- | ------------------------------ | ------------------------------------------------------- |
| `GET`    | `/health`                                   | —                              | Liveness. `200 { "status": "ok" }`.                     |
| `GET`    | `/config`                                   | —                              | Return the current config.                              |
| `PUT`    | `/config`                                   | `{ periods, defaultPeriod }`   | Full replace (both required). 200 / 400.                |
| `PATCH`  | `/config`                                   | `{ periods?, defaultPeriod? }` | Partial merge over the current. 200 / 400.              |
| `GET`    | `/config/notifications`                     | —                              | List notification configs (id + type + name). 200.     |
| `POST`   | `/config/notifications`                     | `{ notificationType, name, botToken, chatId }` | Create a config; returns the view. **201** / 400 / 409. |
| `GET`    | `/config/notifications/:id`                 | —                              | Get one config's view (no bot token). 200 / 404.        |
| `PATCH`  | `/config/notifications/:id`                 | `{ name?, botToken?, chatId? }` | Partial update; `notificationType` is immutable. 200 / 400 / 404 / 409. |
| `DELETE` | `/config/notifications/:id`                 | —                              | Delete a config. **204** / 404.                         |
| `GET`    | `/instruments?q=&type=`                     | —                              | Discover instruments (optionally filtered by type). 200 / 400. |
| `GET`    | `/symbols?enrich=`                          | —                              | List the watchlist; `?enrich=true` attaches a `quote` per symbol. 200. |
| `POST`   | `/symbols`                                  | `{ id, periods? }`             | Add (validates existence). **201** / 400 / 404 / 409.   |
| `PATCH`  | `/symbols/:id`                              | `{ periods }`                  | Change a symbol's periods. 200 / 400 / 404.             |
| `DELETE` | `/symbols/:id`                              | —                              | Remove a symbol **and its stored candles**. **204**.    |
| `GET`    | `/symbols/:id/candles?period=&from=&to=&limit=` | —                          | Read a keyset-paginated page of stored candles. 200 / 400. |
| `POST`   | `/symbols/:id/backfill`                     | `{ period, from?, to? }`       | Start a backfill **job**; returns **202** with the running job. 202 / 400 / 404 / 409. |
| `GET`    | `/symbols/:id/backfill/jobs/:jobId`         | —                              | Get a backfill job's current state. 200 / 404.          |
| `WS`     | `/symbols/:id/backfill/jobs/:jobId/progress` | —                             | Stream a job's snapshots (full job per frame, keyed by job id). |
| `GET`    | `/profiles`                                 | —                              | List profiles. 200.                                     |
| `POST`   | `/profiles`                                 | `{ name, description?, enabled?, scope? }` | Create. **201** / 400 / 409.       |
| `GET`    | `/profiles/:id`                             | —                              | Get one. 200 / 404.                                     |
| `PUT`    | `/profiles/:id`                             | `{ name, description?, enabled?, scope? }` | Full replace. 200 / 400 / 404 / 409. |
| `PATCH`  | `/profiles/:id`                             | `{ name?, description?, enabled?, scope? }` | Partial update. 200 / 400 / 404 / 409. |
| `DELETE` | `/profiles/:id`                             | —                              | Delete. **204** / 404.                                  |
| `GET`    | `/profiles/:id/indicators`                  | —                              | List the profile's attached indicators. 200 / 404.     |
| `POST`   | `/profiles/:id/indicators`                  | `{ indicatorKey, inputs?, label? }` | Attach an indicator. **201** / 400 / 404.          |
| `GET`    | `/profiles/:id/indicators/:instanceId`      | —                              | Get one attached instance. 200 / 404.                   |
| `PUT`    | `/profiles/:id/indicators/:instanceId`      | `{ indicatorKey, inputs?, label? }` | Full-replace an instance. 200 / 400 / 404.         |
| `DELETE` | `/profiles/:id/indicators/:instanceId`      | —                              | Detach an instance. **204** / 404.                      |
| `GET`    | `/profiles/:profileId/state/global`         | —                              | The profile's current global state map (`{ [key]: StateValue }`; `{}` when empty). 200. |
| `GET`    | `/symbols/:id/state?profileId=`             | —                              | The symbol's current state map for a profile. 200 / 400 / 404. |
| `GET`    | `/symbols/:id/state-keys`                   | —                              | Alphabetical `[{ key, valueType }]` of every state key the symbol has been written under. 200 / 404. |
| `GET`    | `/symbols/:id/state/:key/series?from=&to=`  | —                              | One key's `[{ ts, value }]` time-series for the symbol (ascending by `ts`). 200 / 404. |
| `GET`    | `/indicators`                               | —                              | List every registered indicator definition (descriptors only). 200. |
| `GET`    | `/indicators/:key`                          | —                              | Get one definition by key. 200 / 404.                   |
| `GET`    | `/symbols/:id/indicators/:key?period=&…`    | —                              | Compute the indicator over the symbol's stored candles. 200 / 400 / 404. |
| `GET`    | `/rules?profileId=&symbolId=&enabled=`      | —                              | List rules, filterable; sorted by `order`. 200.         |
| `POST`   | `/rules`                                    | Rule input                     | Create a rule. **201** / 400 (incl. tick-eligibility `fields[]`). |
| `GET`    | `/rules/:id`                                | —                              | Get one rule by id. 200 / 404.                          |
| `PATCH`  | `/rules/:id`                                | Partial rule input             | Partial merge; re-validates the merged rule. 200 / 400 / 404. |
| `DELETE` | `/rules/:id`                                | —                              | Delete a rule. **204** / 404.                           |
| `GET`    | `/rules/:id/events?limit=&before=&from=&to=` | —                             | One rule's mirrored events log (newest-first). 200 / 404. |
| `GET`    | `/symbols/:id/rule-events?limit=&before=&from=&to=&chartStates=` | —          | One symbol's mirrored events log (newest-first), optionally `chartStates`-filtered. 200 / 400. |
| `GET`    | `/symbols/:id/rule-events/count`            | —                              | `{ count }` of the symbol's mirrored events. 200.       |
| `GET`    | `/backtest-strategies`                      | —                              | List backtest strategies. 200.                          |
| `POST`   | `/backtest-strategies`                      | `{ name, description?, entry, exit }` | Create a strategy. **201** / 400 / 409.          |
| `GET`    | `/backtest-strategies/:id`                  | —                              | Get one strategy. 200 / 404.                            |
| `PUT`    | `/backtest-strategies/:id`                  | `{ name, description?, entry, exit }` | Full replace. 200 / 400 / 404 / 409.             |
| `DELETE` | `/backtest-strategies/:id`                  | —                              | Delete a strategy. **204** / 404.                       |
| `POST`   | `/backtests`                                | `{ strategyId, symbolId, profileId, period, start, end, initialCapital, commission? }` | Start a run **job**; returns **202** with the running backtest. 202 / 400 / 404 / 409. |
| `GET`    | `/backtests?status=`                        | —                              | List backtests (the running one merged in); `?status=running\|completed` filters. 200. |
| `GET`    | `/backtests/:id`                            | —                              | Get one backtest — running (params + `progress`) or the completed result. 200 / 404. |
| `PATCH`  | `/backtests/:id`                            | `{ name }`                     | Rename a completed backtest. 200 / 400 (running) / 404. |
| `DELETE` | `/backtests/:id`                            | —                              | Running: cancel + discard; completed: delete + cascade events. **204** / 404. |
| `GET`    | `/backtests/:id/events?from=&to=&limit=`    | —                              | A completed run's events, windowed newest-first. 200 / 400 (running) / 404. |
| `WS`     | `/stream`                                   | —                              | Multiplexed live stream: subscribe/unsubscribe to candles, indicators, quotes, and rule events; receive live frames. |

### Config resource

- **`periods`** — the supported periods; each one of `1m`, `5m`, `15m`, `30m`, `1h`, `4h`, `1d`, `1w`.
- **`defaultPeriod`** — the period shown by default; must be one of `periods`.

Defaults, when nothing is stored: `periods` = `1h`, `1d`; `defaultPeriod` = `1d`.

### Notifications

A generic notification-config resource keyed by a stable `id`, carrying a `notificationType` discriminator (reusing the rule engine's `NotificationChannel`) so more channels can be added behind one common shape.
Telegram is the only channel today.
`notificationType` is **immutable** — a `PATCH` body carrying it is rejected **400**.
`botToken` is write-only — never listed or echoed back; the list returns `{ id, notificationType, name }` and the single-config view adds `chatId` (never the token).
`POST` **creates** (a duplicate `name` → **409**); `DELETE` returns **204**, or **404** when the id is unknown.
Rules resolve a destination by its `name`, so names stay unique.

### Symbols resource

Discover instruments and manage the watchlist.
Canonical ids are `<type>:<ticker>` (`crypto`, `stock`, `fund`, `fx`), e.g. `crypto:BTCUSDT` — crypto is served by Binance, stocks/funds/FX by Yahoo.
An instrument carries `{ id, type, description, exchange, currency? }`; `currency` is present from Binance and a Yahoo lookup, but absent from Yahoo *search* results (so a discovery hit may omit it; a watched symbol always has it).
A watched symbol's `periods` default to the config's `periods` and must be a subset of them.

- `GET /instruments?q=&type=` — free-text discovery across the sources; `type` narrows to one asset class.
- `POST /symbols` — add (validates existence at the source): **201**, or **404** when the id doesn't exist at its source, **409** when re-adding an already-watched symbol (re-adding never changes its periods; use `PATCH`), **400** on an invalid period or one the source can't serve.
- `PATCH /symbols/:id` — change the watched periods (200 / 400 / 404).
- `DELETE /symbols/:id` — remove the symbol and its stored candles (**204**).

With `?enrich=true`, each item carries a `quote` computed server-side from the symbol's stored candles on the config's `defaultPeriod` (strictly — no fallback): `{ price, change, changePct, period, time }`, where `change` is period-over-period (`latestClose − previousClose`) and `changePct` is `change / previousClose`.
`quote` is **`null`** when the symbol does not watch `defaultPeriod` or has fewer than two candles stored there.
Absent or `?enrich=false` returns the plain list.

A symbol's nested sub-resources are served by their owning modules: `/candles` + `/backfill` by the candles module, `/state` + `/state-keys` + `/state/:key/series` by the state module, `/indicators/:key` (compute) by the indicators module, and `/rule-events[/count]` by the rules module.

### Candles & backfill resource

Backfill historical OHLC candles for a **watched** symbol+period into MongoDB and read them back.
A candle is the OHLC base `{ type, time, open, high, low, close }` plus per-asset-class fields — crypto adds `volume`/`quoteVolume`/`trades`, equities add `volume`, FX adds none; `time` is the open time in epoch ms.
`from`/`to` are epoch ms; omit both on a backfill to fetch the provider's deepest available history. The `period` must be one of the symbol's watched periods.

A backfill runs **asynchronously** (ADR-0008): `POST` validates synchronously, starts the work in the background, and returns **202** with a job `{ id, symbolId, period, status, progress, summary, error }` (`status` is `running` | `succeeded` | `failed`; `progress` is `{ phase, done, total }` — `phase` is `fetching` (retrieving from the provider, `total` estimated) then `saving` (persisting, `total` = actual fetched count), `done` the count so far; `summary` is set on success; `error` on failure).
Poll `GET …/jobs/:jobId` or stream the WebSocket for updates.
Synchronous client errors are preserved: **404** when the symbol isn't watched, **400** for a period it doesn't watch or an invalid range, **409** when a backfill for that symbol+period is already running.
An upstream provider failure does not fail the POST — the job goes `failed` with the provider's reason in `error`.

The summary is `{ id, period, from, to, fetched, saved, complete }` (`from`/`to` are the first/last persisted candle time, or `null` when nothing was fetched; `complete` is `false` when the provider capped the fetch and more history may exist).

`GET …/candles` returns one **keyset-paginated** page `{ candles, nextCursor, latestTime }`, where `candles` is ascending by `time`, `nextCursor` is the `time` to pass as the next request's `from` (or `null` on the last page), and `latestTime` is the latest stored candle's `time` for the whole `(symbol, period)` (or `null` when none). `limit` defaults to 100, max 1000 (over the max → 400). Page forward by re-issuing with `from = nextCursor`.

**Progress over WebSocket.**
Connect to `/symbols/:id/backfill/jobs/:jobId/progress` with the `jobId` from the 202 response.
The socket immediately receives the job's current snapshot, then a frame on each state change (progress tick and the terminal `succeeded`/`failed`), each the full job object.
Frames are keyed by job id, so concurrent jobs never interleave; intermediate progress is not replayed.
A job is only streamable under its own symbol path; otherwise the socket gets a single `{ error }` frame and closes.
Nest's `@WebSocketGateway` cannot path-match URL params, so this route is served by a raw `ws` server that handles the HTTP `upgrade` for exactly this URL pattern (`BackfillProgressGateway`) — preserving the URL + protocol byte-for-byte so the web client is unchanged.

### Profiles resource

A **profile** is a named, enable/disable-able template scoped to watched symbols — either all of them (the default) or an explicit subset.
A profile is `{ id, name, description, enabled, scope, createdAt, updatedAt, indicators }`, where `scope` is either `{ "type": "all" }` or `{ "type": "symbols", "symbolIds": [...] }`.
Names are unique.
Every id in a `symbols` scope must be currently watched, and an empty subset normalizes to `all`.

- `POST /profiles` — create (**201**), **400** on invalid input or a scope referencing an unwatched symbol, **409** on a duplicate name.
- `PUT /profiles/:id` — full replace; preserves `id`, `createdAt`, and the attached `indicators` (200 / 400 / 404 / 409).
- `PATCH /profiles/:id` — partial update; omitted fields keep their current value (200 / 400 / 404 / 409).
- `DELETE /profiles/:id` — delete (**204** / 404).

Removing a watched symbol prunes it from every profile's subset.
A profile left with an empty subset is **disabled** (kept symbols-scoped) rather than widened to `all`.

**Attached indicators (sub-resource).**
A profile holds zero or more attached indicator instances — a configured indicator from the catalog with validated inputs, addressed by a stable id.
An instance is `{ id, indicatorKey, version, inputs, label?, summary? }`; `indicatorKey` refers to a catalog module (`sma` / `vwma`), `inputs` is validated against that module's descriptors, and `summary` is a derived display string added on read.

- `POST /profiles/:id/indicators` — attach (**201**); **400** on an unknown key or invalid inputs, **404** on an unknown profile.
- `PUT /profiles/:id/indicators/:instanceId` — full-replace (200 / 400 / 404).
- `DELETE /profiles/:id/indicators/:instanceId` — detach (**204** / 404).

### State resource

Read-side views of the rule-engine state — the per-profile global key/value store and the per-profile per-symbol state maps (the engine itself writes state through the orchestrator; these routes only read it back).
State is **partitioned by profile** (#281): two profiles operating on the same symbol see isolated `state.*` namespaces, so every state read takes a `profileId`.
A `StateValue` is a tagged scalar: `{ "type": "string" | "number" | "bool", "value": ... }` (ADR-0013).

- `GET /profiles/:profileId/state/global` — the profile's current global state map (`{ [key]: StateValue }`; `{}` when empty). The profile need not exist — an unknown `profileId` returns `{}`.
- `GET /symbols/:id/state?profileId=` — the symbol's current state map for a profile (`{}` when empty). Requires the symbol to be watched (**404** otherwise) and a `profileId` query (**400** when missing).

**State history (chart overlays — #434).**
Two read-only routes reconstruct a per-symbol state-key catalog and a per-key time-series from the already-persisted rule-event log (`StateSet` / `StateRemoved` entries on the watchlist document's `events` array).
Both are watchlist-scoped (**404** on an unknown symbol id) and, unlike the maps above, are **not** partitioned by profile — `RuleEventEntry` carries no `profileId`, so every key written against the symbol is returned regardless of which profile's rule wrote it.

- `GET /symbols/:id/state-keys` — the alphabetical `[{ key, valueType }]` catalog of every state key the symbol has been written under.
- `GET /symbols/:id/state/:key/series?from=&to=` — one key's time-series: one `{ ts, value }` per `StateSet`, one `{ ts, value: null }` per `StateRemoved`, ascending by `ts`. `from` is inclusive, `to` is exclusive (both epoch ms; omit either side for an open bound).

### Indicators resource

The **indicator catalog** plus an ad-hoc **compute** route.
The catalog is every registered indicator module's serialized `IndicatorDefinition` — the input/state schema a UI form renderer or action condition-builder reads (never the `compute` function).
A state field descriptor carries a `type` of `number`, `enum`, or `bool` (ADR-0022); the `type` tells the operand picker which `StateValue` an `IndicatorRef` at that field resolves to (`number` / `string` / `bool`).

- `GET /indicators` — list every registered definition.
- `GET /indicators/:key` — get one definition by key (**404** with `{ error }` on an unknown key).
- `GET /symbols/:id/indicators/:key?period=…&…` — compute the indicator over the symbol's stored candles.

The compute route takes the indicator's scalar inputs as query parameters alongside the required `period`, optional `from` (epoch ms), and optional `to` (epoch ms):

- `curl 'http://localhost:3000/symbols/crypto:BTCUSDT/indicators/sma?period=1h&length=3'`
- `curl 'http://localhost:3000/symbols/crypto:BTCUSDT/indicators/sma?period=1h&length=3&from=1704153600000'`
- `curl 'http://localhost:3000/symbols/crypto:BTCUSDT/indicators/vwma?period=1h&length=14&multiplier=1&direction=both'`

Numeric inputs like `length` come in as query strings; the service coerces them to numbers before validating against the indicator's descriptors.
The response is `{ indicatorKey, version, period, state }`, where `state` is the aligned per-bar series (leading rows `null` during warm-up).

- **404** when the symbol isn't on the watchlist or the indicator key is unknown.
- **400** on invalid inputs (out-of-range, wrong type) or an asset-class mismatch (e.g. an FX symbol with a volume-based indicator).

### Rules resource

CRUD over the greenfield v2 rules (ADR-0016) plus the chart-facing read of each rule's / symbol's mirrored event log.
A rule pairs a `scope` (`Symbol` / `Symbols` / `AllSymbols`), a `condition` tree, a `trigger` cadence, and one or more `actions` (notification / state writes); the server stamps `id`, `createdAt`, `updatedAt`.
An `IndicatorRef` operand carries a `valueType` (`number` / `string` / `bool`): a non-numeric field (an enum-`string` like VWMA's `signal`, or a `bool` like its `above`) resolves through the same projected indicator series as a numeric one and is compared via the `State` operators (`Equals` / `NotEquals` / `ChangesTo` / `ChangesFrom`); the series-aware operators (`Crossing` / `Moving` / `Channel`) stay numeric (ADR-0022).

- `GET /rules?profileId=&symbolId=&enabled=` — list, each filter independent (all AND together), sorted by `order`.
- `POST /rules` — create. **201** with the stamped rule. A tick-cadence trigger (`EveryTime` / `Once` / `OncePerBar`) on a scope whose symbol isn't watched is rejected **400** with a `fields[]` entry per unwatched symbol (`{ path: "scope.symbolId", message: "symbol not on watchlist: <id>" }`); an invalid condition or an unwatched condition interval is a **400** `{ error }`.
- `GET /rules/:id` — get one (**404** on an unknown id).
- `PATCH /rules/:id` — partial merge, re-validated against the same boundary (**200** / 400 / 404).
- `DELETE /rules/:id` — delete (**204** / 404).

**Event logs (chart markers — ADR-0014).**
Each fire mirrors its entries onto both the rule and the affected symbol; reads are newest-first and paginated.

- `GET /rules/:id/events?limit=&before=&from=&to=` — one rule's events log (**404** on an unknown rule). `limit` defaults to 50 (max 500); `from` is inclusive and `to` / `before` are exclusive bounds on the entry's source `ts` (epoch ms).
- `GET /symbols/:id/rule-events?limit=&before=&from=&to=&chartStates=` — one symbol's mirrored events log. `chartStates` is a JSON-encoded array of state keys (e.g. `["price:trend"]`): when present the read keeps only `stateSet` / `stateRemoved` entries whose `key` is in the list (`[]` ⇒ none); when absent the read is unfiltered. A malformed `chartStates` or a non-numeric `from` / `to` is a **400**.
- `GET /symbols/:id/rule-events/count` — `{ count }` of the symbol's mirrored events (backs the chart's Events badge).

### Backtest strategies resource

Plain CRUD over reusable, symbol-agnostic backtest strategies (`backtesting/` subsystem), mirroring `/profiles`.
A strategy pairs a required `entry.signal` (an edge-triggered symbol-scoped state change `{ key, value }`, where `value.type` doubles as the key's declared type) with an `exit` that sets at least one of a `signal`, a `profitTarget`, or a `stopLoss` threshold (`{ kind: fixed | percentage, amount }`); the server stamps `id`, `createdAt`, `updatedAt`.

- `GET /backtest-strategies` — list all strategies.
- `POST /backtest-strategies` — create (**201**). A blank name, a missing entry signal, or an empty exit is a **400** `{ error }`; a duplicate name is a **409**.
- `GET /backtest-strategies/:id` — get one (**404** on an unknown id).
- `PUT /backtest-strategies/:id` — full replace; preserves `id` and `createdAt` (**200** / 400 / 404 / 409).
- `DELETE /backtest-strategies/:id` — delete (**204** / 404). Deleting a strategy does **not** cascade to saved backtests — each backtest carries its own embedded strategy snapshot.

### Backtests resource

One resource with a run lifecycle (`backtesting/` subsystem).
`POST /backtests` validates synchronously — `start < end`, `end ≤ now`, `initialCapital > 0`, non-negative commissions, a complete strategy, an enabled + in-scope profile, and at least one stored candle in `[start, end)` across the symbol's active periods (else a **400** with a "backfill first" hint); unknown strategy / symbol / profile ids are **404** — then starts a server-side run **job** and returns **202** with the running backtest (`status: running`, plus `progress`).
Only one run is active at a time; a second start is a **409**.
The job replays every stored candle of all the symbol's active periods within the window through an **isolated** rule engine (its own in-memory state store, event log, indicator series store, and once-per-bar latch, seeded with the profile's rules and a no-op notifier) — it never touches the live state store, live event log, or the notifier, and a `NotificationSent` is recorded in the run's own log without a send.
Candles are ordered by completion time (`time + periodMillis`), ties finest-period-first, and rule/indicator lookbacks reaching before `start` resolve on demand from stored history.
The strategy's trading model runs over that feed — long-only, one position, all-in compounding: an edge-triggered entry signal buys at the producing candle's close with cash-constrained sizing (`notional = (equity − fixed) / (1 + rate/100)`); exit signals sell at the close, while entry-relative profit-target / stop-loss levels fill intrabar at the level (stop-loss before profit-target, both before that candle's engine events, the entry candle exempt); commissions apply per fill and `pnl` is net; equity compounds trade to trade.
It yields `trades[]` (each `{ entryTs, exitTs, entryPrice, exitPrice, quantity, commission, pnl, roiPct, exitReason }` with `exitReason` ∈ `signal | profitTarget | stopLoss`), an `openPosition?` for a position still open at `end` (`{ entryTs, entryPrice, quantity, entryCommission, unrealizedPnl }`), and a `summary` over the **closed** trades (`{ totalPnl, roiPct, avgPnlPerTrade, tradeCount, winners, losers, avgRoiPct, avgDaysInTrade }`).
On completion the run auto-persists under its id (auto-generated `{strategy} · {symbol} · {period} · {start}→{end}` name, `params`, `strategyId`, a full strategy snapshot, `profileId` + `profileName`, plus `trades`, `openPosition?`, and `summary`) with its events in their **own** collection keyed by `backtestId`.

- `GET /backtests` — list every backtest, the in-memory running one merged in; `?status=running|completed` filters.
- `GET /backtests/:id` — running: params + `progress`; completed: the full saved result. **404** on an unknown id.
- `PATCH /backtests/:id` — rename a completed backtest (**400** while running; **404** unknown).
- `DELETE /backtests/:id` — running: cancel + discard (nothing persisted); completed: delete + cascade its events. **204** either way; **404** unknown.
- `GET /backtests/:id/events?from&to&limit` — a completed run's events windowed newest-first (same shape as the rule-events window); **400** while running; **404** unknown.

### Live stream

With the poll loop running (started on boot by the runtime activation), the service pushes new candles — plus any subscribed indicator's recomputed state, any subscribed symbol's recomputed quote, and any subscribed symbol's mirrored rule events — to clients over one **multiplexed** WebSocket.
A single socket can watch many symbols and hold many indicator / quote subscriptions in parallel.

| Method | Path      | Description                                                                                  |
| ------ | --------- | ------------------------------------------------------------------------------------------- |
| `WS`   | `/stream` | Subscribe/unsubscribe to candles, indicators, quotes, and rule events; receive live frames. |

After connecting, send JSON control messages.
The route multiplexes four surfaces: candle, indicator, quote, and rule-event.
A malformed control message is answered with an `{ "error": "<reason>" }` frame (a non-JSON payload with `{ "error": "invalid JSON message" }`) rather than being silently dropped; closing the socket releases every subscription on it.

**Candle subscriptions** — keyed by symbol id.

- `{ "action": "subscribe", "id": "crypto:BTCUSDT" }` — start receiving that symbol; `{ "action": "unsubscribe", "id": "crypto:BTCUSDT" }` — stop.
- For each polled candle of a subscribed symbol the socket receives `{ "id": "crypto:BTCUSDT", "period": "1h", "candle": { … }, "final": false }`.
  `final` is `true` once the bar has closed and `false` for the still-forming bar.
  The stream is live-only — it does not replay history.

**Indicator subscriptions** — keyed by a server-generated `subscriptionId`, scoped to `(id, period, indicator: { key, inputs })`.

- `{ "action": "subscribe-indicator", "id": "crypto:BTCUSDT", "period": "1h", "indicator": { "key": "sma", "inputs": { "length": 3 } } }` — the server validates (symbol watched, indicator known, asset-class match, inputs valid) and replies with `{ "action": "subscribed-indicator", "subscriptionId": "…", "id": "crypto:BTCUSDT", "period": "1h", "indicatorKey": "sma" }`.
  A validation failure replies with `{ "error": "<reason>" }` and opens no subscription.
- `{ "action": "unsubscribe-indicator", "subscriptionId": "…" }` — stop.
- For each polled candle on the subscribed `(id, period)` a state frame is delivered: `{ "subscriptionId": "…", "id": "crypto:BTCUSDT", "period": "1h", "indicatorKey": "sma", "state": { "time": 1704153600000, "value": 42.5 }, "final": false }`.
  `state` carries only the latest point; `final` mirrors the candle's `final`.

**Quote subscriptions** — keyed by a server-generated `subscriptionId`, scoped to a symbol id; the quote is derived on the config's `defaultPeriod` (the live counterpart of `GET /symbols?enrich=true`).

- `{ "action": "subscribe-quote", "id": "crypto:BTCUSDT" }` — the server validates (symbol watched, watches `defaultPeriod`, has ≥ 2 candles there) and replies with `{ "action": "subscribed-quote", "subscriptionId": "…", "id": "crypto:BTCUSDT", "period": "1d" }`.
  A validation failure replies with `{ "error": "<reason>" }`.
- `{ "action": "unsubscribe-quote", "subscriptionId": "…" }` — stop.
- For each polled candle on the symbol's `defaultPeriod` a quote frame is delivered: `{ "subscriptionId": "…", "id": "crypto:BTCUSDT", "period": "1d", "quote": { "price": 110, "change": 10, "changePct": 0.1, "time": 1704153600000 }, "final": true }`.
  `change` / `changePct` are measured against the previous close; after a `final: true` frame the baseline rotates to the just-closed bar.

**Rule-event subscriptions** — keyed by symbol id — the mirrored side of the event log's append fan-out.

- `{ "action": "subscribe-rule-event", "id": "crypto:BTCUSDT" }` — start receiving each `RuleEventEntry` appended to that symbol's events log; `{ "action": "unsubscribe-rule-event", "id": "crypto:BTCUSDT" }` — stop.
- For each successful symbol-side append the socket receives `{ "symbolId": "crypto:BTCUSDT", "entry": { … } }`, where `entry` is the same `RuleEventEntry` tagged union the REST event-log endpoints return.

Nest's `@WebSocketGateway` cannot path-match URL params or share one path with another gateway, so `/stream` is served by a raw `ws` server that handles the HTTP `upgrade` for exactly this URL (`StreamGateway`) — preserving the URL + protocol byte-for-byte so the web client is unchanged, and coexisting with the backfill-progress WebSocket on the same server.

## API documentation

Interactive OpenAPI docs (Swagger UI) are served at `/docs`; the raw spec is at `/docs/json`.

## Error contract

Every error surfaces as the uniform `{ "error": "<reason>" }` body (with an additive `fields: [{ path, message }]` array on validation-style failures).
Domain errors map to status by a single global filter: `*NotFoundError` → **404**, `*ConflictError` → **409**, client-input `*Error` (and DTO validation) → **400**, `MarketDataError` → **502**, anything else → **500**.

## Configuration

All settings are read once at boot through `@nestjs/config` and validated by `validateEnv`; a malformed value fails fast at startup.
Feature code takes values from `ConfigService`, never from `process.env` directly.

| Variable                | Default                                                                       | Notes                                                                 |
| ----------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `MONGODB_URI`           | `mongodb://lametrader:lametrader@localhost:27017/lametrader?authSource=admin` | Root Mongo connection string.                                         |
| `REDIS_URL`             | `redis://localhost:6379`                                                       | Redis backing the persistent OncePerBar latch (#513, ADR-0020).       |
| `PORT`                  | `3000`                                                                         | HTTP listen port; must be an integer in `1..65535`.                   |
| `POLL_INTERVALS`        | per-period ladder (see `env.validation.ts`)                                   | JSON object of `period → ms` overrides, merged over the defaults.     |
| `LOG_LEVEL`             | `info`                                                                         | One of `fatal, error, warn, info, debug, trace`.                      |
| `LOG_SCOPES`            | `[]`                                                                           | Comma-separated `pattern:level` overrides (validated; applied later). |

## Run

```sh
# Build to dist/, then start (needs a reachable MONGODB_URI + REDIS_URL).
npm run build -w @lametrader/backend
npm run start -w @lametrader/backend

# Type-check only.
npm run typecheck -w @lametrader/backend
```

### Memory / heap

A backtest run preloads the requested candle window into memory before replaying it, so a large multi-year fine-grained run (e.g. years of 1-minute candles) needs a higher Node heap ceiling than the default.
The `start` and `start:dev` scripts run the server with `--max-old-space-size=4096` (a 4 GB old-space ceiling), and VS Code's "Debug backend" launch config sets `NODE_OPTIONS=--max-old-space-size=4096` for the same reason.
Bump the number for larger runs.

## Deploy

The server ships as a container built from `packages/backend/Dockerfile` (a multi-stage build over the repo root: `npm ci`, build `@lametrader/core` then the server, prune dev deps, then `node packages/backend/dist/main.js`).
It is the `server` service of the `app` compose profile, behind the web SPA's nginx `/api/*` reverse proxy (single-origin, no CORS; the `Upgrade` headers carry the backfill-progress and `/stream` WebSockets through):

```sh
# Build + run the full stack (mongo + server + web) from the repo root.
npm run app:up          # docker compose --profile app up -d --build
npm run app:logs:server # tail the server's structured logs
npm run app:down        # tear it down
```

The compose `server` service passes `MONGODB_URI`, `REDIS_URL`, `PORT`, `POLL_INTERVALS`, `LOG_LEVEL`, and `LOG_SCOPES` (all with sane defaults) and has a `GET /health` healthcheck the web service waits on.
The default (no-profile) compose brings up **Mongo + Redis** so the local `be:start:dev` loop has both; Redis backs the rule engine's persistent OncePerBar latch (#513, ADR-0020).

## Test

This package uses **Jest** (the rest of the monorepo uses Vitest).
SWC transforms the decorator-driven sources and emits the DI metadata Nest reads at runtime.

- **unit** — `.spec.ts` files beside the code under `src`, fast and deterministic.
- **e2e** — `.e2e-spec.ts` files under `test`, booting the app against a [Testcontainers](https://testcontainers.com) Mongo and hitting it over HTTP (requires Docker).

```sh
npm run test -w @lametrader/backend        # unit tier
npm run test:e2e -w @lametrader/backend    # e2e tier (Docker required)
```

Both runners are orchestrated from the repo root: `npm run check` runs Vitest (other packages) plus this package's Jest unit tier; `npm run check:full` adds both e2e tiers.

## Tooling notes

- **tsconfig** overrides `experimentalDecorators` + `emitDecoratorMetadata` (needed by Nest's DI) locally, and drops `composite`/`declaration` so this app-only package type-checks with `--noEmit` and stays out of the root project-references graph (compiled on its own, like `web`).
- **Biome** disables `style/useImportType` for this package (root `biome.json` override): with `emitDecoratorMetadata`, a class used only as a constructor-injection type must stay a runtime import, but that rule would rewrite it to `import type` and break DI.
