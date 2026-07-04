# NestJS monolith replaces the hexagonal multi-package architecture

- Status: accepted
- Supersedes: 0001

## Context

The five-package hexagonal layout (`core` → `engine` → `api`/`cli`/`web`) was chosen when the platform had three axes of variation to protect (ADR-0001).
In practice the cost outgrew the benefit: workspace project references, internal version pins, a hand-rolled composition root (`connectServices`), a hand-rolled settings/logging/scheduling layer, and two driving surfaces (CLI + HTTP) that each duplicated every feature's surface, tests, and docs.
The CLI carried no unique capability — every command has an HTTP equivalent, nothing imports the package, and the polling loop only ever ran under the API process.

## Decision

Collapse the backend into a single idiomatic NestJS application, `@lametrader/backend`, and delete the CLI.

- Three packages remain: `server` (Nest monolith — HTTP, WS, use-cases, adapters, scheduling), `core` (slimmed to a types-only package so `web`'s imports survive unchanged), and `web`.
- The hexagonal rules are dropped; NestJS conventions replace them: feature modules, controllers → injectable services → injected models, Express platform, class-validator DTOs, `@nestjs/config`, `nestjs-pino`, `@nestjs/schedule`, `@nestjs/mongoose`.
- Existing engine logic relocates as-is where possible; the Mongo repositories and the polling loop are rewritten onto Mongoose and `SchedulerRegistry` respectively.
- The HTTP/WS contract is preserved exactly (routes, status mapping, `{ error, fields }` envelope, raw-WS `/stream` protocol), so `web` is untouched and the ported e2e suite proves the swap.
- The migration lands as staged strangler PRs; `main` stays green throughout.

The full decision set, staging plan, and acceptance criteria live in `specs/nestjs-monolith-migration.spec.md`.

## Considered Options

- **Keep the hexagon, only drop the CLI** — removes one surface but leaves the package/wiring overhead that motivated the change.
- **Nest app as a thin driving adapter over `core`/`engine`** — purest continuity, but preserves the multi-package structure that is the pain.
- **Rings-as-folders inside the monolith** — keeps hexagonal vocabulary while fighting Nest's module grain; rejected in favor of full idiom.
- **Native Mongo driver / Vitest / Fastify adapter retained** — each rejected for the same reason: once the framework is Nest, the beaten path (Mongoose, Jest, Express) costs less than preserving bespoke choices.

## Consequences

- Test doubles lose their architectural mandate but survive as infrastructure: in-memory fakes and shared contract suites port to Jest, and the contract suites are the safety net proving the Mongoose rewrite is behavior-identical.
- The domain is no longer compile-time isolated from I/O; discipline moves from package boundaries to module conventions and review.
- Two test runners coexist (Jest for `server`, Vitest for `web`), confined to root script orchestration.
- CLAUDE.md's architecture and conventions sections must be rewritten with the cutover (spec stage 6).
