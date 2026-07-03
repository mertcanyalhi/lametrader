# Spec: NestJS monolith migration — drop the CLI, collapse the backend

- Status: approved
- Touches: **everything** — deletes `cli`, `api`, `engine`; creates `server`; slims `core` to types-only; leaves `web` behaviorally untouched.
- Decision record: ADR-0018 (supersedes ADR-0001).

## Goal

The platform has outgrown its five-package hexagonal layout in the wrong direction: the packages, project references, version pins, and hand-rolled wiring cost more than the flexibility they bought.
Collapse the backend into a single idiomatic NestJS monolith (`@lametrader/server`), delete the CLI surface, and keep `@lametrader/core` only as a slim shared-types package so `web` keeps compiling unchanged.

Non-goals: no behavior change, no API redesign, no web changes.
The HTTP/WS contract is preserved byte-for-byte; the ported e2e suite is the proof.

## Decisions (from the planning interview)

1. **Motivation** — the pain is package/wiring overhead, dual driving surfaces (CLI + API), and DIY framework glue.
   The hexagonal rules themselves are dropped (ADR-0018); idiomatic NestJS conventions replace them.
2. **Topology** — three packages: `server` (NestJS monolith: HTTP, WS, use-cases, adapters, scheduling), `core` (types-only: interfaces + enums, no logic), `web` (unchanged).
   `core` keeps its name so `web`'s ~102 `@lametrader/core` imports survive untouched.
3. **Internal layout** — fully idiomatic Nest: feature modules (`ConfigModule`, `SymbolsModule`, `CandlesModule`, `ProfilesModule`, `IndicatorsModule`, `RulesModule`, `StateModule`, `NotificationsModule`, `StreamModule`, `MarketDataModule`, `MongoModule`), controllers → injectable services → injected models/clients.
   No formal port interfaces; slim interfaces survive only where a test fake needs substitution via Nest DI overrides.
4. **Engine code fate** — relocate mostly as-is (rule engine, indicators, backfill, quote stream, notifier, market-data sources become providers); rewrite where relocation fights Nest's grain.
   Explicit rewrites: repositories (→ Mongoose) and polling (→ `@nestjs/schedule`).
5. **CLI** — deleted outright.
   Nothing imports `@lametrader/cli`; every CLI command already has an HTTP equivalent; the CLI never ran the polling loop.
6. **HTTP platform** — Express (Nest default).
7. **Validation** — class-validator DTO classes + global `ValidationPipe` with a custom `exceptionFactory` emitting the existing `{ error, fields }` envelope; `@nestjs/swagger` (CLI plugin) generates `/docs` from the same DTOs.
   TypeBox is deleted.
8. **API contract** — preserved exactly: route table, status mapping (404 not-found / 409 conflict / 400 validation / 502 market-data / 500 fallback) via a global exception filter, `{ error, fields }` envelope, raw-WebSocket multiplexed `/stream` protocol and backfill-progress WS via `@nestjs/websockets` + `@nestjs/platform-ws` (not socket.io).
9. **Nest batteries** — `@nestjs/config` (validated env schema replaces `loadSettings`; same vars, same fail-fast + defaults), `nestjs-pino` (replaces `engine/src/log.ts` and Fastify's logger; scoped child loggers per module), `@nestjs/schedule` (`PollingService` rewritten on `SchedulerRegistry` dynamic timeouts, preserving per-period cadence + jitter behavior; lifecycle hooks replace the hand-rolled SIGTERM handling).
10. **Mongo** — `@nestjs/mongoose` ODM: all seven repositories (candles, config, profiles, state, rules, event log, watchlist) rewritten as Mongoose schemas + `@InjectModel` models; `ensureIndexes()` becomes schema-level index definitions synced on bootstrap.
11. **Testing** — Jest for `server` (Nest default; decorator metadata via SWC/ts-jest transform), Vitest stays for `web`.
    Three tiers keep their meaning (`unit` / `e2e` / `live`); root scripts orchestrate both runners; `check` / `check:full` semantics unchanged.
    In-memory fakes and shared contract suites survive as plain test infrastructure (no architectural rule attached), ported to Jest; the contract suites are the net proving the Mongoose rewrite is behavior-identical.
12. **Sequencing** — staged strangler PRs; `main` stays green at every step; the old `api` keeps serving until the cutover stage.

## Staged plan

Each stage is one PR (branch per CLAUDE.md naming), lands green, and is independently revertable.

### Stage 1 — drop the CLI

- `packages/cli` is deleted; the root `cli` script and the `@lametrader/cli` Vitest alias are removed.
- `npm run check:full` passes; no remaining reference to `@lametrader/cli` outside `package-lock.json` history and archived specs.

### Stage 2 — scaffold `@lametrader/server`

- New Nest app package (Express platform) with `@nestjs/config` (env schema covering `MONGODB_URI`, `PORT`, `POLL_INTERVALS`, `TELEGRAM_DESTINATIONS`, `LOG_LEVEL`, `LOG_SCOPES`), `nestjs-pino`, `MongoModule` (Mongoose root connection), Jest wiring (unit + e2e projects, Testcontainers), and a `GET /health` endpoint.
- The existing `api` package is untouched and still the deployed backend.
- Root scripts run both runners; `check` / `check:full` stay green.

### Stage 3 — port resource-by-resource (several PRs)

Per resource (suggested order: config → symbols → candles/backfill → indicators → profiles → state → rules → notifications → stream/WS):

- Controller + DTOs are rewritten in Nest idiom; the route table and payload shapes for that resource match the current `packages/api/README.md` table exactly.
- The backing engine services relocate into the owning feature module as providers; their unit tests port to Jest beside them.
- The resource's Mongoose repository replaces the native-driver one; its contract suite (in-memory + Testcontainers Mongo) passes unchanged.
- The resource's API e2e tests port to the server package (supertest / ws client) and pass.

### Stage 4 — cutover

- `infra/docker-compose.yml` app profile serves `server` instead of `api`; web's nginx `/api` proxy target updated; `packages/api` is deleted.
- Polling starts via lifecycle hook on bootstrap and stops on shutdown (parity with old `main.ts`).
- Swagger served at `/docs`; full ported e2e suite green against the Nest app.

### Stage 5 — dissolve `engine`, slim `core`

- All remaining `engine` code (rule engine, market-data sources, notifier, quote stream, indicators) lives in `server`; `packages/engine` is deleted.
- `core` contains only type declarations (interfaces, enums, pure type utilities); all logic has moved to `server`; `web` compiles without changes.
- Root `tsconfig` references, workspace pins, and Vitest config reflect the three-package layout.

### Stage 6 — docs & rules

- CLAUDE.md rewritten: architecture section describes the Nest monolith and its conventions; hexagonal rules, port/adapter vocabulary, CLI references, and Fastify-specific conventions removed; command table updated.
- ADR-0018 finalized; ADR-0001 marked superseded.
- `server` README documents the module layout and endpoints; `cli`/`api`/`engine` READMEs deleted with their packages.

## Risks & mitigations

- **Mongoose semantic drift** (casting, `_id`/date handling, defaults) — caught by the kept contract suites and Testcontainers e2e runs per stage.
- **Contract drift breaking web** — the `*-page`/`*-ui` e2e tests pin exact payloads; they port before cutover.
- **Dual-runner friction** (Jest + Vitest) — confined to root script orchestration; each package sees exactly one runner.
- **Long-lived dual-package state** (api + server both alive during stage 3) — bounded by resource-by-resource PRs; cutover deletes the old package the moment parity is proven.
