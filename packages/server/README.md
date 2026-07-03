# @lametrader/server

The backend monolith — an idiomatic [NestJS](https://nestjs.com) application on the Express platform.

This package is stage 2 of the NestJS migration (see `specs/nestjs-monolith-migration.spec.md` and ADR-0018).
Today it is the cross-cutting shell that every later resource module plugs into: validated configuration, structured logging, the root Mongo connection, and a health endpoint.
It runs alongside the still-deployed `@lametrader/api`; the resource controllers, repositories, and the polling loop are ported in later stages.

## What's here

- **Bootstrap** (`src/main.ts`, `src/app.module.ts`) — boots a Nest app on Express and serves `GET /health`.
- **Config** (`src/config`) — `@nestjs/config` with a `validate` hook (`validateEnv`) that resolves and validates the environment into a typed `AppConfig`.
  Same variables, defaults, and fail-fast behavior as the previous `packages/engine/src/settings.ts` (`loadSettings`).
- **Logging** (`src/logging`) — [`nestjs-pino`](https://github.com/iamolegga/nestjs-pino) for request and application logging.
  The root level comes from `LOG_LEVEL`; records carry an `{ app: 'server' }` base field; modules take a scoped child logger by injecting `PinoLogger` and calling `setContext(scope)` (the pino twin of the engine's `getLogger(scope)`).
- **Mongo** (`src/mongo`) — `@nestjs/mongoose` opening the root connection from `MONGODB_URI`.
  Connection only — no schemas or repositories yet.
- **Health** (`src/health`) — `GET /health` → `200 { "status": "ok" }`.

## Endpoints

| Method | Path      | Response                    |
| ------ | --------- | --------------------------- |
| `GET`  | `/health` | `200 { "status": "ok" }`    |

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
