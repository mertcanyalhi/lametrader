# @lametrader/server

The backend monolith — an idiomatic [NestJS](https://nestjs.com) application on the Express platform.

This package is stage 3 of the NestJS migration (see `specs/nestjs-monolith-migration.spec.md` and ADR-0018).
On top of the cross-cutting shell (validated configuration, structured logging, the root Mongo connection, a health endpoint) it serves the first ported resources — the **config + Telegram notifications** surface and the **symbols + instruments** surface — and establishes the app-wide HTTP contract every later resource reuses.
It runs alongside the still-deployed `@lametrader/api`; the remaining resource controllers, repositories, and the polling loop are ported in later stages.

## What's here

- **Bootstrap** (`src/main.ts`, `src/app.module.ts`) — boots a Nest app on Express, mounts the OpenAPI docs, and wires the global error filter + validation pipe.
- **Env config** (`src/config/env.validation.ts`, `app-config.types.ts`) — `@nestjs/config` with a `validate` hook (`validateEnv`) that resolves and validates the environment into a typed `AppConfig`.
  Same variables, defaults, and fail-fast behavior as the previous `packages/engine/src/settings.ts` (`loadSettings`).
- **Config resource** (`src/config`) — the `ConfigModule`: `ConfigService` over a Mongoose-backed key-value store (`config` collection), behind the `/config` controller.
- **Notifications** (`src/notifications`) — the `NotificationsModule`: `TelegramDestinationsService` (destinations CRUD, stored in the same config K/V store) and `TelegramNotifier` (Bot API sender), behind the `/config/notifications/telegram` controller.
- **Symbols** (`src/symbols`) — the `SymbolsModule`: `SymbolService` over a Mongoose-backed watchlist (`watchlist` collection) and the market-data sources, behind the `/instruments` + `/symbols` controller.
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

The nested sub-resources of a symbol (`/symbols/:id/candles`, `/state`, `/indicators`, `/rule-events`) are ported with their own feature modules in later stages.

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
