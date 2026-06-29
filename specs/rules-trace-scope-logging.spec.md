# Spec: rules engine per-scope trace logging

- Status: implemented
- Touches: `packages/engine/src/settings.ts`/`settings.types.ts`, `packages/engine/src/log.ts`, `packages/engine/src/rules/dispatch/evaluate-condition.ts`, `packages/engine/src/rules/dispatch/dispatcher.ts`, `packages/engine/src/rules/orchestrator/action-runner.ts`, `packages/engine/src/rules/orchestrator/orchestrator.ts`, `packages/engine/src/rules/wire/wire-rule-engine.ts`, `packages/engine/src/rules/bridges/*-bridge.ts`

## Goal

Make the rules engine debuggable without flipping the global `LOG_LEVEL` to `trace`.
Today only four orchestrator-internal trace lines exist; per-leaf condition decisions, dispatcher routing, action execution, and bridge cascades are silent.
Adds the missing trace coverage and gates each surface on a per-scope log level so a user can enable `engine.rules.dispatch:trace` (or `engine.rules.*:trace`) without the rest of the engine joining the firehose.

Closes #436.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] `loadSettings` parses a `LOG_SCOPES` env value (`"engine.rules.*:trace,engine.api:info"`) into a `logScopes` `{ pattern, level }` array, preserving order.
- [ ] `loadSettings` rejects a malformed `LOG_SCOPES` entry (missing `:`, unknown level) with a clear error.
- [ ] `loadSettings` defaults `logScopes` to `[]` when `LOG_SCOPES` is unset.
- [ ] `getLogger('engine.rules.dispatch')` honors a `logScopes` entry whose `pattern` matches that scope, overriding the global `logLevel` on that child only.
- [ ] `getLogger` matches `*` (and prefix `foo.*`) patterns against the scope name, and falls back to the global level on no match.
- [ ] `getLogger` applies the **first** matching entry from `logScopes` (later entries lose, so users can list narrow patterns before broad ones).
- [ ] `evaluateCondition` emits a `leaf_decision` trace under `engine.rules.operators` carrying `{ family, operator, leftKind, leftValue, leftPrev, rightKind?, rightValue?, rightPrev?, result }` for each evaluated leaf.
- [ ] `TriggerDispatcher.dispatch` emits a `dispatcher_decision` trace under `engine.rules.dispatch` per inbound event carrying `{ eventKind, eventTs, candidates: ruleId[], eligible: ruleId[], dropped: { ruleId, reason }[] }`.
- [ ] `ActionRunner.run` emits an `action_executed` trace under `engine.rules.actions` per action carrying `{ ruleId, actionKind, payload, outcome, durationMs }` — `outcome` is one of `'ok' | 'error'`.
- [ ] `StateCascadeBridge.handleStateChange` emits a `bridge_emit` trace under `engine.rules.bridges` carrying `{ bridge: 'state-cascade', inboundEventKind, emittedEventKind, payload }`.
- [ ] `IndicatorCascadeBridge.handleIndicatorState` emits a `bridge_emit` trace per state key that changed (silent on unbound subscriptions / unchanged keys).
- [ ] `TickBridge.handleQuote` and `BarLifecycleBridge.handleCandle` each emit a `bridge_emit` trace per outbound event.
- [ ] No new `process.env` reads outside `settings.ts`; no `debug` package added.

## End-to-end expectation

A new e2e test (`packages/engine/tests/e2e/per-scope-trace.e2e.test.ts`):

- Wires the rule engine with `logScopes: [{ pattern: 'engine.rules.*', level: 'trace' }]`, captures every emitted log line on a recording sink, drives one `Price > 100` tick rule end-to-end (tick → fire → state mutation), and asserts the captured stream contains at least one record per scope (`engine.rules.bridges`, `engine.rules.dispatch`, `engine.rules.operators`, `engine.rules.actions`, `engine.rules.orchestrator`).
- Critical failure mode: with `logScopes: []` (default), the same drive emits no `trace`-level records for any of those scopes — global level is still `info`.

## Out of scope

- Augmenting `Fired.context` with per-leaf outcomes (Q4: traces only in the live log stream).
- Promoting existing orchestrator traces to `debug` (Q3: keep at `trace`; they ride `engine.rules.orchestrator` along with everything else).
- A shared Fastify request-id correlation between API requests and engine traces (Q5: deferred).
- Adopting the npm `debug` package (Q1B: explicitly rejected — violates CLAUDE.md Pino-only mandate).
- Glob libraries (minimatch/micromatch): `*` and `prefix.*` cover the spec's needs; no new dependency.
- Renaming existing scopes beyond what's strictly necessary for the per-scope pattern to apply consistently — only `rules-orchestrator` → `engine.rules.orchestrator` and `rules-wire` → `engine.rules.wire` are renamed (so a single `engine.rules.*` enables every engine-rules surface).

## Surprises
