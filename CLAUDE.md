# lametrader

This is a TypeScript monorepo for a quant trading platform for asset tracking, technical indicator analysis, automated signal generation, and historical backtesting; it ingests market data from multiple sources, persists it, and serves it over an HTTP + WebSocket API and a web UI.

## Architecture & principles

Idiomatic NestJS, kept pragmatic.

The backend is a single NestJS monolith (`@lametrader/backend`) on the Express platform.
Structure follows Nest's grain, not a layered ring diagram: **feature modules**, each a controller → injectable service → injected repositories/providers, wired by dependency injection.
See `docs/decisions/0018-nestjs-monolith-replaces-hexagonal-architecture.md` for why the earlier hexagonal multi-package layout (`core` → `engine` → `api`/`cli`/`web`) was collapsed into this — ADR-0018 supersedes ADR-0001.

- **Feature modules** — one per resource (`ConfigModule`, `NotificationsModule`, `SymbolsModule`, `ProfilesModule`, `CandlesModule`, `StateModule`, `IndicatorsModule`, `RulesModule`, `StreamModule`, `MarketDataModule`, …).
  A module owns its controller, its service, its DTOs, and its persistence, and imports the other modules it needs.
- **Dependency injection via provider tokens** — a service depends on an interface bound to a token (`CANDLE_REPOSITORY`, `WATCHLIST_REPOSITORY`, `STATE_REPOSITORY`, `RULE_REPOSITORY`, `EVENT_LOG`, `MARKET_DATA_SOURCES`, …), never on a concretion.
  The owning module binds the token to its Mongoose adapter; a test overrides it with an in-memory fake through Nest's testing DI.
- **Shared-persistence-module pattern** — a store used by more than one feature is owned by exactly one module that registers ONE Mongoose model and binds + **exports** ONE repository token (`WatchlistModule`, `CandlesModule`, `StateModule`, `EventLogModule`).
  Every other module `imports` it and resolves the one shared instance; the owning module depends only on the root Mongo connection, so the module graph stays acyclic.
- **One global HTTP contract** — a global `DomainExceptionFilter` maps domain errors to status codes (`*NotFoundError` → 404, `*ConflictError` → 409, client-input `*Error` + DTO validation → 400, `MarketDataError` → 502, anything else → 500), and a global `ValidationPipe` validates every DTO at the boundary; both emit the uniform `{ error, fields? }` envelope.
- **class-validator / class-transformer DTOs** — request/response shapes are DTO classes at the boundary; `@nestjs/swagger` generates the OpenAPI docs at `/docs` from the same classes.
- **Nest batteries, not bespoke glue** — `@nestjs/config` (a validated env schema) for settings, `nestjs-pino` for structured logging, `@nestjs/schedule` for the polling loop, `@nestjs/mongoose` for persistence.
- **WebSockets** — both the param'd per-job backfill-progress socket and the multiplexed `/stream` socket are served by raw `ws` servers on the HTTP `upgrade` (not socket.io, and not `@WebSocketGateway`'s path routing), each matching only its own URL so the two coexist on one server.
- **Dormant producers, live only from `main.ts`** — the poll loop, rule engine, quote stream, and their producer→hub fan-out are constructed idle in their modules and started once, by `LiveCascadeService`, from `main.ts` **after** `app.listen()`.
  The e2e suites build the app via `Test.createTestingModule` and never reach that call, so they touch no real market-data provider.

`@lametrader/core` stays a pure shared-types package (types, enums, a handful of runtime constants) that both the server and the browser import; it performs no I/O and pulls no server dependency into the browser bundle.

- Use RESTful API structure.
- Use enums instead of stringed types.

Anti-dogma, unchanged in spirit: abstract on the *second* instance, not in anticipation.
No interface-behind-a-token until a second adapter or a test fake actually needs to substitute one.
Prefer small pure functions over tiny ceremonial classes.
No indirection that doesn't pay for itself.

## Project layout

npm workspaces under `packages/*` — three packages:

- **`core`** — the shared types/enums package: interfaces, enums, and a handful of runtime constants (`periodMillis`, the input-limit constants) both the backend and the browser agree on.
  No I/O, no outward imports.
- **`server`** — the NestJS monolith backend: the whole HTTP + WebSocket surface, the use-cases, the market-data adapters, persistence, and the polling / rule-engine runtime.
- **`web`** — the browser app (React + Vite).

**Adding to the backend** — the server is one Nest app, so a new resource is a new **feature module** under `packages/backend/src/<resource>/` (controller, service, DTOs, Mongoose schema + repository), imported into `AppModule`.
A new shared store follows the shared-persistence-module pattern above (own the model + a repository token in one module, export it, import it where needed).
There is no new-package ceremony for backend features.

**Adding a shared type** — put it in `core` under `src/types/<context>/` as a `*.types.ts` (or an enum), grouped with its context (`market-data`, `config`, `indicators`, `profiles`, `state`, `notifications`, `rules`), and re-export the public surface from `packages/core/src/index.ts`, so both `server` and `web` import it from the package root.

**Only `core` sits in the root project-references graph.**
`server` and `web` are app-only packages compiled on their own, outside the root refs (`tsconfig.json` references just `packages/core`):

- **`server`** — its `tsconfig.json` enables the decorator metadata Nest's DI needs (`experimentalDecorators` + `emitDecoratorMetadata`) and drops `composite`/`declaration` so it type-checks with `--noEmit`.
  Its `typecheck` script is picked up by the root `typecheck`'s `--workspaces --if-present` pass.
- **`web`** (Vite-owned, browser) — its `tsconfig.json` overrides `composite`/`declaration: false`, `noEmit: true`, `lib: [ES2022, DOM, DOM.Iterable]`, `module: ESNext`, `moduleResolution: Bundler`, `jsx: react-jsx`.
  Vite builds it (`vite build`); its `typecheck` script (`tsc --noEmit`) is likewise picked up by the root `typecheck`.
  Component tests run in `jsdom` via Vitest: add `// @vitest-environment jsdom` at the top of the test file.

## Development flow

Every change: **spec → red → green → refactor → check → commit**, one concern at a time.

1. **Spec** — write `specs/<name>.spec.md`; acceptance criteria as a bullet list.
   Each bullet = one test; code mapping to no bullet isn't written.
2. **Red** — turn each criterion into a failing unit test (full-payload `toEqual`).
3. **Green** — minimal code to pass; keep to the module conventions (a service over injected ports, not a controller reaching into Mongoose).
4. **Refactor** — clean under green tests; abstract only on the second instance.
5. **E2E** — every major feature gets an e2e suite (poll → persist → process → assert) plus its one critical failure mode: `packages/backend/test/*.e2e-spec.ts` (Jest, over HTTP/WS) for the backend, `packages/ui/tests/e2e/*.e2e.test.ts` (Vitest) for the UI.
6. **Check** — `npm run check:full` green.
7. **Commit** — one logical concern, Conventional Commits message.
   Do **not** bump package `version`s here — versioning is a separate flow (`/release`), driven off the conventional-commit history.

`/implement`, `/adr`, `/ship` automate this loop.
`/release` is the separate versioning flow — run it when cutting a release, not per change.

### Fast-track (bug fixes, trivial changes)

When a change doesn't alter any spec's described behaviour, the full ceremony is overkill.
Use a streamlined flow:

1. **Reproduce** — write a failing test (unit or e2e) that demonstrates the bug.
2. **Fix** — minimal code to make it pass.
3. **Check** — `npm run check:full` green.
4. **Commit** — one logical concern, Conventional Commits message; no spec or ADR update.

The fast track applies when there's no behaviour change: typo fixes, flaky-test stabilization, dependency bumps, format-only edits, internal refactors covered by existing tests.
Anything that adds, removes, or changes documented behaviour goes through the full spec-driven flow.

### Test tiers

Two runners, one per package family — **Jest** for `server` (Nest's default; SWC compiles the decorators and emits the DI metadata), **Vitest** for `web` and `core`.
Each package sees exactly one runner; the root scripts orchestrate both.

- **unit** (default) — pure logic + services against in-memory fakes.
  Fast, deterministic; the TDD tier and the bulk of tests.
  Co-located beside the code (`*.spec.ts` under `server/src`, `*.test.ts(x)` under `web` / `core` `src`).
- **e2e** — validate a feature from the **end-user / spec perspective**, driving a real surface.
  `server` e2e (`packages/backend/test/*.e2e-spec.ts`) boots the Nest app against a Testcontainers Mongo and drives it over HTTP / WS; `web` e2e (`packages/ui/tests/e2e/*.e2e.test.ts`) drives the UI.
  One suite per major feature.
- **live** — raw adapter against a real external API (`*.live.test.ts`).
  Flaky; manual only.
- Contract suites = one shared spec run against **both** the in-memory fake and the Mongoose adapter (the net proving the two behave identically).

### Gates

- `check` (typecheck + lint + unit) — run it locally before every commit; CI runs it on push to `main` (a cheap post-merge safety net).
- `check:full` (+ e2e) — CI on every PR (the pre-merge gate).
- Docs-only changes (`**.md`, `docs/**`, `specs/**`) skip CI.

## Commands

All routine actions go through these scripts — don't invoke `tsc` / `vitest` / `jest` / `biome` directly.

| Script                             | Does                                                       |
| ---------------------------------- | ---------------------------------------------------------- |
| `npm run build`                    | build the project-refs graph (`core`)                      |
| `npm run typecheck`                | type-check the refs graph + each workspace's `typecheck`   |
| `npm run lint` / `lint:fix`        | Biome check / auto-fix                                     |
| `npm run format`                   | Biome format (write)                                       |
| `npm test` / `test:watch`          | Vitest unit tier (`web` + `core`)                          |
| `npm run test:e2e`                 | Vitest e2e tier (`web`)                                    |
| `npm run test:live`                | Vitest live tier (real APIs)                               |
| `npm run test:server`              | Jest unit tier (`server`)                                  |
| `npm run test:server:e2e`          | Jest e2e tier (`server`, Testcontainers Mongo)             |
| `npm run coverage`                 | Vitest unit + coverage                                     |
| `npm run check`                    | typecheck + lint + Vitest unit + server Jest unit          |
| `npm run check:full`               | check + both e2e tiers (CI on PR)                          |
| `npm run be:start` / `be:start:dev`| start the backend built / in watch mode (`@lametrader/backend`) |
| `npm run fe:start` / `fe:start:dev`| serve the built web app / start the Vite dev server        |
| `npm run infra:up/down/logs/reset` | docker compose infra (Mongo)                               |
| `npm run app:up/down/logs/build`   | docker compose full app profile (mongo + server + web)     |

## Conventions

Follow these by default, unprompted.

### Tests

- Assert the FULL payload: `expect(x).toEqual({...whole object})` — never `toMatchObject` or per-field.
- Floats: `expect.closeTo(n, digits)` as an asymmetric matcher inside `toEqual`.
- The tiers beyond unit (`e2e`, `live`) are Jest / Vitest **projects**, selected with `--selectProjects` / `--project` by the root scripts.
  No env flags / `runIf`.
- Unit tests sit beside the code in `src`.
  E2e tests assert a feature from the end-user/spec perspective and live apart from `src` — `packages/backend/test/*.e2e-spec.ts` for the backend, `packages/ui/tests/e2e/*.e2e.test.ts` for the UI.
- Never `.skip` a test to land a change.
- **One action per test.**
  Arrange the setup, perform a single action, assert the full outcome.
  Different actions = different tests.
- **Test names are full sentences describing behaviour** — `'<unit> does <something> when/given <condition>'`, not `'test1'` or `'works'`.
- **DAMP over DRY in tests.**
  Repeating setup inline is fine if it keeps each test self-contained and readable.
  Only extract a helper when the abstraction earns its keep.
- **No logic in test bodies** — no `if`/loops/ternaries/conditional assertions.
  Branching cases get separate tests.
- **Prefer real implementations over mocks.**
  Use a fake adapter (e.g. `InMemoryWatchlistRepository`, bound over the repository token via a Nest DI override) over a stub, a stub over a mock.
  Only mock external systems we don't own.
- **Each test is hermetic** — sets up everything it needs and runs in isolation.
  Never `sleep()` to wait for something; poll a condition or use an event hook.

### Types & docs

- Strict TS: keep `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride` on.
  Handle cases, don't weaken.
- Multi-line JSDoc (`/**\n * ... */`) on every interface, property, type, function, class, method, notable constant.
- Type declarations (interfaces, type aliases, enums) live in a sibling `*.types.ts` module, separate from logic.
  Public ones are re-exported from the package `index.ts` (in `core`) or the DTO/schema they back (in `server`).
- **Comments and prose break at sentence ends, not line-length wraps** — one sentence per line in JSDoc and in markdown (specs, ADRs, READMEs, this file).
  Each sentence on its own line; a blank line separates distinct thoughts.
  Markdown renders the same (lines within a paragraph are joined) but reads cleanly in source and gives single-line diffs on prose edits.

### No hacky solutions

- A workaround that just makes a problem go away is a signal — the design isn't right yet.
  Fix the underlying mismatch (refine the type, split a domain shape from a transport one, refactor the contract, change the API) instead of silencing the tooling that surfaced it.
- Don't paper over problems with escape hatches.
  Whether it's a type-system cast, an ignore/disable pragma, a permissive flag flipped on, an optional dependency gating behavior conditionally, or a silent fallback hiding a missing path — each tells the next reader "trust me, anything goes" and rots fast.
- A **narrow, checkable** expression of the truth is fine — a precise type, an explicit interface, a required dependency, a documented invariant.
  An **opaque** one (it could be anything, who knows, just trust me) is not.
- If a workaround is genuinely the last resort, document the exact constraint inline **and** open an issue with the proper fix.
  Don't let it slide silently.
- The decision-level form of this same shortcut is the next rule: see **Confirm with the human, never guess**.

### Confirm with the human, never guess

- When a decision the request didn't settle comes up — a design call, an architectural trade-off, a choice between sensible options, the interpretation of an ambiguous spec — **surface it and ask** before implementing.
  Reasoning to "the most plausible answer" and acting silently produces churn: the human reviews, pushes back, the work gets redone.
- The bar isn't every micro-detail (variable names, file layout inside a module).
  It's every spot two readers might reasonably disagree, or where a wrong call would cost more than a clarifying question.
- A clear question with two-to-four labeled options is faster than a wrong-turn refactor.
  Default to asking; the human will say "just go" when they want autonomy.
- The code-level form of this same shortcut is the previous rule: see **No hacky solutions**.

### Dependencies

- Prefer well-established, non-commercial (open-source / freely licensed) industry-standard packages wherever they fit. Avoid commercial/paid or obscure unmaintained deps.

### Shell commands

- Prefer flat single-command calls (`grep -rnE ... file1 file2`, `rg`) over `for`-loops or `cd; …; done` chains.
  The permission matcher can't statically decompose loops/compound scripts, so it prompts every time even when the underlying tools are allowlisted; a flat command matches the allowlist and runs unattended.

### Runtime config

- Resolve environment-derived settings through `@nestjs/config`: a `validate` hook (`validateEnv`) parses and validates the environment into a typed `AppConfig` at boot (same vars, defaults, and fail-fast behavior as the old settings layer), and feature code reads values from the injected `ConfigService`.
  Never read `process.env` directly in feature modules.

### API

- Always RESTful — resource-oriented routes, correct verbs, correct status codes (200/201/204, 400/404/409, 500).
- A controller per resource (`src/<resource>/<resource>.controller.ts`); the feature module wires the controller to its service, and `AppModule` only imports the modules.
- Input validation at the boundary via class-validator DTO classes + the global `ValidationPipe` (unknown properties rejected, body hydrated into the DTO instance).
- Cross-field / domain rules live in the domain and surface as **400** through the thrown domain error + the global `DomainExceptionFilter` — not as DTO constraints.
- Every error is the uniform `{ error, fields? }` envelope; the filter maps domain errors to status (404 / 409 / 400 / 502 / 500).
- Log through `nestjs-pino` (inject `PinoLogger`, `setContext(scope)`); never ad-hoc `console.log`.

### Docs

- Every package exposing a surface keeps a `README.md`.
  A change to an API endpoint or WebSocket protocol updates the `server` `README.md` (the endpoint table + examples) in the same change.

### GitHub workflow

- **Branch names follow `<type>/<kebab-summary>`** — the same `<type>` vocabulary as Conventional Commits (`feat/`, `fix/`, `docs/`, `chore/`, …), then a short kebab-case summary of the change (e.g. `feat/symbols-quote-enrich`, `fix/review-high-findings`).
  Don't develop on an auto-generated branch name (e.g. `claude/feature-35-...`); rename it to this convention before pushing.
- **Always subscribe to PR activity on every PR you open** (via `subscribe_pr_activity`), so CI failures and review comments wake the session up.
  Stop subscribing only when the user explicitly says to.

## Definition of Done

A change is done only when:

- [ ] A spec exists with acceptance criteria.
- [ ] Unit tests derive from the spec and pass (full-payload).
- [ ] A major feature has an e2e test covering it end-to-end.
- [ ] `npm run check:full` is green; nothing `.skip`-ped.
- [ ] It's one logical concern with a Conventional Commits message.
- [ ] API / WebSocket surface changes are reflected in the `server` `README.md`.
- [ ] An ADR is written if a non-obvious decision was made.
- [ ] Prefer deleting code to adding it.
</content>
</invoke>
