# lametrader

This is a TypeScript monorepo for a quant trading platform for asset tracking, technical indicator analysis, automated signal generation, and historical backtesting; ingest market data from multiple sources, persist it, and serve it over an API / CLI / web UI.

## Architecture & principles

Hexagonal (ports & adapters), kept pragmatic.

Rings (inner never imports outer):

- **domain** — entities + pure logic (candle, indicator, signal, backtest). No I/O, no outward imports.
- **ports** — interfaces the core needs (`MarketDataSource`, `CandleRepository`).
- **application** — use-cases wiring ports together.
- **adapters** — implement/drive ports: `binance`, `yahoo`, `mongo` (driven); `http`, `cli`, `web` (driving).

**The one rule: adapters → application → domain, never the reverse.**

- SOLID, applied: new source = new adapter, never edit existing (OCP); domain depends on ports, not concretions (DIP); narrow ports over fat ones (ISP); every adapter passes one shared contract test suite (LSP).
- Anti-dogma: abstract on the *second* instance, not in anticipation. No port until a second adapter or a test fake needs one. Prefer small pure functions over tiny ceremonial classes. No indirection that doesn't pay for itself.

See `docs/decisions/` for the why behind these (ADRs).

- Use RESTful API structure.
- Use enums instead of stringed types.

## Project layout

npm workspaces under `packages/*`: `core` (domain), `engine` (application + driven
adapters), `cli` (driving adapter), `web` (driving adapter, React + Vite). More
packages (sources, api, logger) join the same way.

**Adding a Node package** (`core`/`engine`/`cli`-style):

1. `packages/<n>/package.json` — `@lametrader/<n>`, `"type": "module"`, `main`/`types`
   → `dist/index.js`/`dist/index.d.ts`, `"build": "tsc --build"`. Internal deps pin
   the dependency's **current** `version` (e.g. `"@lametrader/<dep>": "0.4.0"`), so
   npm workspace linking resolves them — `npm ci` 404s on a spec the workspace
   version can't satisfy. Bumping a package's version means updating its dependents'
   pins too.
2. `packages/<n>/tsconfig.json` — extends `../../tsconfig.base.json`, `rootDir: src`,
   `outDir: dist`, `include: ["src"]`, `references` to each internal dep.
3. Add `{ "path": "packages/<n>" }` to the root `tsconfig.json` `references`.
4. `npm install` to link the workspace.

**The `web` package is different** (browser, Vite-owned):

- Its `tsconfig.json` extends base but overrides: `composite/declaration: false`,
  `noEmit: true`, `lib: [ES2022, DOM, DOM.Iterable]`, `module: ESNext`,
  `moduleResolution: Bundler`, `jsx: react-jsx`.
- **Not** in the root project-refs graph — Vite builds it (`vite build`). Its
  `typecheck` script (`tsc --noEmit`) is picked up by the root `typecheck`'s
  `--workspaces --if-present` pass.
- Component tests run in `jsdom`: add `// @vitest-environment jsdom` at the top of
  the test file (keeps them in the default `unit` run without a node/DOM split).

## Development flow

Every change: **spec → red → green → refactor → check → commit**, one concern at a time.

1. **Spec** — write `specs/<name>.spec.md`; acceptance criteria as a bullet list. Each bullet = one test; code mapping to no bullet isn't written.
2. **Red** — turn each criterion into a failing unit test (full-payload `toEqual`).
3. **Green** — minimal code to pass; respect the dependency rule.
4. **Refactor** — clean under green tests; abstract only on the second instance.
5. **E2E** — every major feature gets a `*.e2e.test.ts` (poll → persist → process → assert) + its one critical failure mode.
6. **Check** — `npm run check:full` green.
7. **Commit** — one logical concern, Conventional Commits message. Do **not** bump package `version`s here — versioning is a separate flow (`/release`), driven off the conventional-commit history.

`/feature`, `/adr`, `/ship` automate this loop. `/release` is the separate
versioning flow — run it when cutting a release, not per change.

### Test tiers

- **unit** (default) — pure domain + application vs fake adapters. Fast, deterministic. The TDD tier; bulk of tests. Co-located in `src` beside the code (`*.test.ts`).
- **e2e** — validate a feature from the **end-user / spec perspective**, driving real surfaces (HTTP, CLI) against real infra. Kept **separate** from `src`, in `packages/<pkg>/tests/e2e/*.e2e.test.ts` — one suite per major feature. Run in `check:full` / CI.
- **live** — raw adapter vs real external API (`*.live.test.ts`). Flaky; manual only.
- Port contracts = one shared suite, run against both the fake (unit) and the real adapter (live).

### Gates

- `check` (typecheck + lint + unit) — native git pre-commit hook + CI on every push.
- `check:full` (+ e2e) — CI on PRs.

## Commands

All routine actions go through these scripts — don't invoke `tsc`/`vitest`/`biome` directly.

| Script                             | Does                                      |
| ---------------------------------- | ----------------------------------------- |
| `npm run build`                    | build all (project refs)                  |
| `npm run typecheck`                | type-check via project refs               |
| `npm run lint` / `lint:fix`        | Biome check / auto-fix                    |
| `npm test` / `test:watch`          | unit tier                                 |
| `npm run test:e2e`                 | e2e tier                                  |
| `npm run test:live`                | live tier (real APIs)                     |
| `npm run coverage`                 | unit + coverage                           |
| `npm run check`                    | typecheck + lint + unit (pre-commit + CI) |
| `npm run check:full`               | check + e2e (CI on PR)                    |
| `npm run infra:up/down/logs/reset` | docker compose infra                      |

## Conventions

Follow these by default, unprompted.

### Tests

- Assert the FULL payload: `expect(x).toEqual({...whole object})` — never `toMatchObject` or per-field.
- Floats: `expect.closeTo(n, digits)` as an asymmetric matcher inside `toEqual`.
- Two opt-in tiers beyond unit (`e2e`, `live`) via Vitest projects (`--project`). No env flags / `runIf`.
- Unit tests sit beside the code in `src`; e2e tests live in `packages/<pkg>/tests/e2e/` and assert a feature from the end-user/spec perspective.
- Never `.skip` a test to land a change.

### Types & docs

- Strict TS: keep `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride` on. Handle cases, don't weaken.
- Multi-line JSDoc (`/**\n * ... */`) on every interface, property, type, function, class, method, notable constant.
- Type declarations (interfaces, type aliases, enums) live in a sibling `*.types.ts` module, separate from logic; public ones are re-exported from the package `index.ts`.

### Dependencies

- Prefer well-established, non-commercial (open-source / freely licensed) industry-standard packages wherever they fit. Avoid commercial/paid or obscure unmaintained deps.

### Runtime config

- Resolve environment-derived settings via the common settings layer (`loadSettings`, with defaults). Never read `process.env` directly in feature modules.

### API

- Always RESTful — resource-oriented routes, correct verbs, correct status codes (200/201/204, 400/404, 500).
- Separate controllers per resource (`src/controllers/<resource>.controller.ts`); `app.ts` only wires them.
- Schema-based input validation at the boundary (Fastify JSON schema); cross-field/domain rules live in the domain and surface as 400.
- Log through a common log library (Fastify's built-in Pino); never ad-hoc `console.log`.

### Docs

- Every package exposing a surface keeps a `README.md`. A change to a CLI command or API endpoint updates that package's README (usage + examples) in the same change.

## Definition of Done

A change is done only when:

- [ ] A spec exists with acceptance criteria.
- [ ] Unit tests derive from the spec and pass (full-payload).
- [ ] A major feature has an e2e test covering it end-to-end.
- [ ] `npm run check:full` is green; nothing `.skip`-ped.
- [ ] It's one logical concern with a Conventional Commits message.
- [ ] CLI/API surface changes are reflected in the package `README.md`.
- [ ] An ADR is written if a non-obvious decision was made.
- [ ] Prefer deleting code to adding it.
