# @lametrader/server

The backend monolith — an idiomatic [NestJS](https://nestjs.com) application on the Express platform.

This package is stage 3 of the NestJS migration (see `specs/nestjs-monolith-migration.spec.md` and ADR-0018).
On top of the cross-cutting shell (validated configuration, structured logging, the root Mongo connection, a health endpoint) it serves the first ported resources — the **config + Telegram notifications** surface, the **symbols + instruments** surface, the **profiles** surface (with its attached-indicators sub-resource), and the **candles + backfill** surface (reads, the async backfill job, and its per-job progress WebSocket) — and establishes the app-wide HTTP contract every later resource reuses.
It runs alongside the still-deployed `@lametrader/api`; the remaining resource controllers and the cutover that starts the polling loop are done in later stages.

## What's here

- **Bootstrap** (`src/main.ts`, `src/app.module.ts`) — boots a Nest app on Express, mounts the OpenAPI docs, and wires the global error filter + validation pipe.
- **Env config** (`src/config/env.validation.ts`, `app-config.types.ts`) — `@nestjs/config` with a `validate` hook (`validateEnv`) that resolves and validates the environment into a typed `AppConfig`.
  Same variables, defaults, and fail-fast behavior as the previous `packages/engine/src/settings.ts` (`loadSettings`).
- **Config resource** (`src/config`) — the `ConfigModule`: `ConfigService` over a Mongoose-backed key-value store (`config` collection), behind the `/config` controller.
- **Notifications** (`src/notifications`) — the `NotificationsModule`: `TelegramDestinationsService` (destinations CRUD, stored in the same config K/V store) and `TelegramNotifier` (Bot API sender), behind the `/config/notifications/telegram` controller.
- **Symbols** (`src/symbols`) — the `SymbolsModule`: `SymbolService` over a Mongoose-backed watchlist (`watchlist` collection) and the market-data sources, behind the `/instruments` + `/symbols` controller.
  It imports the `ProfilesModule` and injects its `ProfileService` as the symbol-removal → profile-prune cascade (ADR-0009): removing a symbol prunes it from every profile's `symbols` scope.
- **Profiles** (`src/profiles`) — the `ProfilesModule`: `ProfileService` over a Mongoose-backed profile store (`profiles` collection), behind the `/profiles` controller (CRUD + the attached-indicators sub-resource). Validates a `symbols` scope against the watchlist and attached-indicator inputs against the indicator registry.
- **Candles** (`src/candles`) — the `CandlesModule`: the single owner of the Mongoose-backed candle store (`candles` collection), binding and exporting the `CANDLE_REPOSITORY` token (the shared-persistence pattern; the symbols use-case imports it for quote enrichment + the remove cascade). It drives the `BackfillService` (reads) and `BackfillJobService` (async jobs) behind the `/symbols/:id/candles` + `/backfill` controller, and serves the per-job progress WebSocket via the `BackfillProgressGateway` (a raw `ws` server on the HTTP upgrade, matching the param'd URL).
- **State** (`src/state`) — the `StateModule`: the single owner of the Mongoose-backed rule-engine state store (`state` collection), binding and exporting the `STATE_REPOSITORY` token (the shared-persistence pattern; per-`profileId` partitioning + the tagged-union `StateValue` round-trip preserved). It drives the read-side state controller (`GET /profiles/:profileId/state/global`, `GET /symbols/:id/state`) and the chart state-overlay routes (`GET /symbols/:id/state-keys`, `GET /symbols/:id/state/:key/series`) via the relocated `StateHistoryService`, which reads a symbol's mirrored rule events off the `watchlist` document's embedded `events` array. It imports the shared `WatchlistModule` for the watched-symbol 404 guard.
- **Indicators** (`src/indicators`) — the `IndicatorsModule`: the shared, read-only `IndicatorRegistry` (catalog of the shipped `sma` / `vwma` modules, pure logic) built by `defaultIndicators` and exported for the profiles use-case to validate against. The indicators HTTP routes are added on top of this module in a later stage.
- **Market data** (`src/market-data`) — the `MarketDataModule`: the registered discovery sources (Binance for crypto, Yahoo for stocks/funds/FX) bound to the `MARKET_DATA_SOURCES` token, fanned out by the symbols use-case (and, later, backfill/polling).
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
| `GET`    | `/config/notifications/telegram`            | —                              | List destinations (name + chat id; no bot tokens). 200. |
| `POST`   | `/config/notifications/telegram`            | `{ name, botToken, chatId }`   | Upsert by `name`; returns the summary. **200** / 400.   |
| `DELETE` | `/config/notifications/telegram/:name`      | —                              | Remove by name. **204** / 404.                          |
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
| `POST`   | `/profiles`                                 | `{ name, description?, enabled?, scope?, chartStates? }` | Create. **201** / 400 / 409.       |
| `GET`    | `/profiles/:id`                             | —                              | Get one. 200 / 404.                                     |
| `PUT`    | `/profiles/:id`                             | `{ name, description?, enabled?, scope?, chartStates? }` | Full replace. 200 / 400 / 404 / 409. |
| `PATCH`  | `/profiles/:id`                             | `{ name?, description?, enabled?, scope?, chartStates? }` | Partial update. 200 / 400 / 404 / 409. |
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

### Config resource

- **`periods`** — the supported periods; each one of `1m`, `5m`, `15m`, `30m`, `1h`, `4h`, `1d`, `1w`.
- **`defaultPeriod`** — the period shown by default; must be one of `periods`.

Defaults, when nothing is stored: `periods` = `1h`, `1d`; `defaultPeriod` = `1d`.

### Notification destinations

Telegram is the only channel today (the `/config/notifications` prefix leaves room for siblings).
`botToken` is write-only — never listed or echoed back; reads return `{ name, chatId }` only.
`POST` upserts by `name` (a repeat name replaces its token + chat id in place) and returns **200**; `DELETE` returns **204**, or **404** when the name is unknown.

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

The remaining nested sub-resources of a symbol (`/indicators`, `/rule-events`) are ported with their own feature modules in later stages; `/candles` + `/backfill` are served by the candles module below, and `/state` + `/state-keys` + `/state/:key/series` by the state module below.

### Candles & backfill resource

Backfill historical OHLC candles for a **watched** symbol+period into MongoDB and read them back.
A candle is the OHLC base `{ type, time, open, high, low, close }` plus per-asset-class fields — crypto adds `volume`/`quoteVolume`/`trades`, equities add `volume`, FX adds none; `time` is the open time in epoch ms.
`from`/`to` are epoch ms; omit both on a backfill to fetch the provider's deepest available history. The `period` must be one of the symbol's watched periods.

A backfill runs **asynchronously** (ADR-0008): `POST` validates synchronously, starts the work in the background, and returns **202** with a job `{ id, symbolId, period, status, progress, summary, error }` (`status` is `running` | `succeeded` | `failed`; `progress` is `{ saved, total }` once a chunk lands; `summary` is set on success; `error` on failure).
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
A profile is `{ id, name, description, enabled, scope, chartStates, createdAt, updatedAt, indicators }`, where `scope` is either `{ "type": "all" }` or `{ "type": "symbols", "symbolIds": [...] }`.
Names are unique.
Every id in a `symbols` scope must be currently watched, and an empty subset normalizes to `all`.
`chartStates` is a `string[]` of symbol-state keys whose markers the chart renders for this profile; it defaults to `[]` and is preserved on a `PATCH` that omits it.

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
| `PORT`                  | `3000`                                                                         | HTTP listen port; must be an integer in `1..65535`.                   |
| `POLL_INTERVALS`        | per-period ladder (see `env.validation.ts`)                                   | JSON object of `period → ms` overrides, merged over the defaults.     |
| `TELEGRAM_DESTINATIONS` | `[]`                                                                           | JSON array of `{ name, botToken, chatId }`; names must be unique.     |
| `LOG_LEVEL`             | `info`                                                                         | One of `fatal, error, warn, info, debug, trace`.                      |
| `LOG_SCOPES`            | `[]`                                                                           | Comma-separated `pattern:level` overrides (validated; applied later). |

## Run

```sh
# Build to dist/, then start (needs a reachable MONGODB_URI).
npm run build -w @lametrader/server
npm run start -w @lametrader/server

# Type-check only.
npm run typecheck -w @lametrader/server
```

## Test

This package uses **Jest** (the rest of the monorepo uses Vitest).
SWC transforms the decorator-driven sources and emits the DI metadata Nest reads at runtime.

- **unit** — `.spec.ts` files beside the code under `src`, fast and deterministic.
- **e2e** — `.e2e-spec.ts` files under `test`, booting the app against a [Testcontainers](https://testcontainers.com) Mongo and hitting it over HTTP (requires Docker).

```sh
npm run test -w @lametrader/server        # unit tier
npm run test:e2e -w @lametrader/server    # e2e tier (Docker required)
```

Both runners are orchestrated from the repo root: `npm run check` runs Vitest (other packages) plus this package's Jest unit tier; `npm run check:full` adds both e2e tiers.

## Tooling notes

- **tsconfig** overrides `experimentalDecorators` + `emitDecoratorMetadata` (needed by Nest's DI) locally, and drops `composite`/`declaration` so this app-only package type-checks with `--noEmit` and stays out of the root project-references graph (compiled on its own, like `web`).
- **Biome** disables `style/useImportType` for this package (root `biome.json` override): with `emitDecoratorMetadata`, a class used only as a constructor-injection type must stay a runtime import, but that rule would rewrite it to `import type` and break DI.
