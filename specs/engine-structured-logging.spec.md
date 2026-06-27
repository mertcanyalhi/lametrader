# Spec: engine structured logging (Pino)

- Status: draft
- Touches: `packages/engine/src/log.ts` (new), `cascade-error-handler.ts`, `wire-rule-engine.ts`, `connect.ts`, `rule-orchestrator.ts`, `settings.ts`/`settings.types.ts`

## Goal

Give the engine the same `getLogger(scope)` pattern web and api already use (Pino), so debugging "why didn't rule X fire on event Y?" produces a real breadcrumb trail.
The engine currently has zero operational logging — only a bespoke `CascadeErrorLogger` interface used by one handler.
Closes #306.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] `getLogger(scope)` returns a Pino child logger that emits entries carrying `scope` and `app: 'engine'` in every record.
- [ ] The engine log level resolves from `LOG_LEVEL` (one of Pino's standard levels) via `loadSettings`, defaulting to `info` when unset.
- [ ] `loadSettings` rejects an unrecognized `LOG_LEVEL` value with a clear error (fail-fast at startup).
- [ ] `handleCascadeError` writes the failure through the shared engine logger (no more `CascadeErrorLogger` structural interface in the public API).
- [ ] `RuleOrchestrator` emits a `warn` entry when it auto-disables a `Once` rule after firing (per #297).
- [ ] `wireRuleEngine` no longer accepts a `logger` field on `RuleEngineDeps` (modules construct their own).
- [ ] `connectServices` no longer accepts a `logger` option (`ConnectLogger` removed); stream-error catch paths use `getLogger('connect')`.

## End-to-end expectation

The existing `rule-orchestrator-wiring.e2e.test.ts` still passes after the cascade error handler is rewired to construct its own logger — it asserts the synthetic `Error` event lands on the symbol's `events[]`, which is unaffected by the logger shape.

## Out of scope

- Per-event `info` breadcrumbs across every event kind (kept narrow — only the warn-on-auto-disable, which the user can grep for).
- Pino transport configuration (file, syslog) — Pino's default stdout is fine for now.
- Replacing the events-log persistence with structured logs — events stay in their Mongo collections.
- A custom timestamp formatter — Pino's default is fine.
- Touching `mongo-event-log.ts`, `mongo-rule-repository.ts`, `live-evaluation-lookups.ts` — they stay silent until a concrete debugging need lands.

## Surprises
