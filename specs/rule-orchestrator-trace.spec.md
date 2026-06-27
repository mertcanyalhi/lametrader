# Spec: rule orchestrator trace logging

- Status: implemented
- Touches: `packages/engine/src/rules/rule-orchestrator.ts`, `packages/engine/src/rules/evaluation-context.ts`, `packages/engine/src/rules/evaluation-context.types.ts`, `packages/engine/src/log.ts`.

## Goal

Forensic trace of every decision the rule orchestrator takes on one inbound event — which event arrived, which rule started, what each leaf resolved to (and where the operand value came from), whether the trigger gate allowed the fire, and the outcome.
Enabled by running the engine with `LOG_LEVEL=trace` (existing `loadSettings()`); no runtime toggle, no per-rule opt-in, no new public type on the engine surface.
Closes #354.

## Trace points

All records emit through `getLogger('rule-orchestrator')`; Pino auto-injects `ts`, `level`, `app: 'engine'`, `scope: 'rule-orchestrator'`.

| `msg` | Payload |
| --- | --- |
| `event_received` | `{ cascadeDepth, triggeredByRuleId?, eventKind, eventTs, symbolId, eventPayload }` |
| `rule_starting` | `{ ruleId, ruleName, firingSymbolId }` |
| `leaf_decision` | `{ ruleId, leafIndex, operator, leftDescriptor, leftValue, leftSource, rightDescriptor, rightValue, rightSource, result }` |
| `gate_decision` | `{ ruleId, triggerKind, allowed, reason }` |
| `rule_summary` | `{ ruleId, outcome }` |

`leftSource` / `rightSource` ∈ `'event' | 'lookup' | 'literal'` — distinguishes a value pulled from the inbound `RuleEvent` (the #312 fix path), from `EvaluationLookups`, or from the operand's own `Literal`.
`outcome` ∈ `'fired' | 'condition_false' | 'gate_blocked' | 'expired'`.

## Acceptance criteria

Each bullet maps to one test.

- [ ] `event_received` emits per dequeued event with `cascadeDepth: 0` and no `triggeredByRuleId` for the inbound, and `cascadeDepth ≥ 1` plus the originating `triggeredByRuleId` for cascade re-entries.
- [ ] `rule_starting` emits with `{ ruleId, ruleName, firingSymbolId }` at the start of each `(rule, firingSymbol)` evaluation.
- [ ] `leaf_decision` emits per condition-tree leaf with the resolved values and the `leftSource` / `rightSource` discriminator.
- [ ] `leaf_decision` on an `OpenValueChanged` event records `leftSource: 'event'` for an `OpenValue` operand on the same symbol, even when the live `EvaluationLookups` would have returned a different value (the #312 stale-Open scenario).
- [ ] `gate_decision` emits with `triggerKind`, `allowed`, and a non-empty `reason` per dispatch.
- [ ] `rule_summary` emits once per `(rule, firingSymbol)` with the matching outcome.
- [ ] With `logLevel` ≠ `'trace'` (the default), no trace records reach the sink (Pino filters them out).

## Out of scope

- Per-rule or per-symbol opt-in (global toggle only).
- Per-operand-resolution trace and per-action-execution trace.
- Runtime level toggle (signal handler / admin endpoint) — env var + restart only.
- In-memory ring buffer or UI surface for traces.
- Sampling / per-rule rate limits.
- Trace coverage outside `RuleOrchestrator`.
