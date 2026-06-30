## Spec: rules cutover + v1 cleanup

- Status: draft
- Touches: `@lametrader/engine` (drop v1 `rules/`, keep `rules/`), `@lametrader/core` (drop v1 rule types no longer referenced), `@lametrader/api` (drop `/rules` + `/symbols/:id/rule-events` v1 routes), `@lametrader/web` (drop v1 rules UI; promote v2 to `/rules`), `@lametrader/cli` (drop v1 `rules` command if any), docs (ADR 0012 status, ADR 0016 mention)

## Goal

Retire the v1 rules surface end-to-end now that v2 ships behind the flag (issue #396).
The cutover PR deletes v1 code, drops the `rules` feature flag, and surfaces v2 as the only editor at `/rules`.
ADR 0016 (greenfield v2) supersedes ADR 0012 (v1 architecture); we mark that explicitly per the ADR template.

## Acceptance criteria

Each bullet maps to one test (where the behavior is observable) or one code-state assertion (where it's a deletion).

- [ ] No v1 modules remain under `packages/engine/src/rules/` (the directory itself is removed; v2 stays in `packages/engine/src/rules/`).
- [ ] No v1 rule exports remain on the `@lametrader/engine` public surface — i.e. `RuleService`, `wireRuleEngine`, `RuleOrchestrator`, `ActionRunner`, `TriggerEvaluator`, `LiveEvaluationLookups`, `evaluateCondition`, `buildEvaluationContext`, `EvaluationContext`/`EvaluationLookups`, `InMemoryRuleRepository`, `MongoRuleRepository`, `InMemoryEventLog`, `MongoEventLog`, `InMemoryFiringStateRepository`, `MongoFiringStateRepository`, `CandleRuleEventBridge`, `IndicatorRuleEventBridge`, `QuoteRuleEventBridge`, `CycleGuard`, `CycleOverflowError`, `PrevCurrentCache`, `MinuteTimerSource`, `handleCascadeError`, `RuleCreateInput` (v1), `RuleEngineDeps`, `WiredRuleEngine` are no longer exported from `packages/engine/src/index.ts`.
- [ ] No v1 rule types remain on the `@lametrader/core` public surface — i.e. `RuleEventKind`, `RuleEvent` (v1 union) and its variants (`CurrentValueChangedEvent`, `CloseValueChangedEvent`, `OpenValueChangedEvent`, `HighValueChangedEvent`, `LowValueChangedEvent`, `VolumeValueChangedEvent`, `IndicatorValueChangedEvent`, `SymbolStateChangedEvent`, `GlobalStateChangedEvent`, `TimerEvent`), `Trigger` (v1), `TriggerKind` (v1), v1 trigger sub-types, `RuleOperator` (v1), `NumericOperator`, `StateOperator`, v1 `Rule`, v1 condition types (`ConditionNode`/`ConditionNodeKind`/`ConditionOperand`/`OperandKind`), v1 history types, v1 `RuleEventEntry` v1 variants are no longer exported from `packages/core/src/index.ts`. (`TickRuleNotEligibleError` and `RuleNotFoundError` survive because v2 uses them; `RuleError` survives because the API error handler maps it generically.)
- [ ] `connectServices()` returns `ConnectedServices` without a v1 `rules` or `wiredRuleEngine` field; only the v2 `rules` and `wiredRuleEngineV2` survive.
- [ ] The API rejects `GET /rules` and `GET /symbols/:id/rule-events` with 404 (no route registered), and `GET /rules` continues to return the v2 list (smoke).
- [ ] The web app no longer reads the `rules` feature flag; the `/rules` route renders the v2 editor unconditionally; the `Rules v2` sidebar entry is gone (one `Rules` entry routes to the v2 editor).
- [ ] No file under `packages/web/src/pages/rules/` exists (the directory is removed); the v2 pages move from `packages/web/src/pages/rules/` to `packages/web/src/pages/rules/` (so the URL and the source directory match again).
- [ ] No v1 web hooks remain — `lib/hooks/rules.ts`, `lib/hooks/rule-events.ts`, `lib/rule-form-schema.ts`, `lib/draft-rule.ts` are removed.
- [ ] `packages/web/src/lib/feature-flags.ts` is removed (and its test).
- [ ] ADR 0012's status line reads `superseded by 0016`.
- [ ] The chart-page side surfaces that consumed v1 rules (`chart-rules-button`, `chart-events-button`) are removed; chart functionality otherwise unchanged. (Re-adding v2 versions is a follow-up.)
- [ ] The rule-event WebSocket stream subscription kind + its e2e are removed (v1 streams v1 events; v2 streaming is unimplemented per `connect.ts` comment).
- [ ] `npm run check:full` is green.

## End-to-end expectation

The happy path the e2e test asserts: a freshly built API rejects `GET /rules` with 404 (route not registered) and continues to serve `GET /rules` (one new e2e — `rules-v1-cutover.e2e.test.ts` — added in this PR). The existing v2 e2e (`rules.e2e.test.ts`) continues to pass against the same fixture. The web e2e (`rules-ui.e2e.test.ts`) — renamed and updated to read `/rules` instead of `/rules` — continues to pass without a feature flag override.

The one critical failure mode covered by tests: trying to import a removed v1 symbol from `@lametrader/engine` or `@lametrader/core` must fail to type-check (covered implicitly by the gate — if any v2 module still drags a v1 export, TS will fail).

## Out of scope

- Renaming v2 modules / symbols / files (e.g. `RuleService` → `RuleService`, `wire-rule-engine-v2.ts` → `wire-rule-engine.ts`). The acceptance criteria explicitly accept v2's `-V2` suffixes per the issue framing: "or keep -v2 suffixes if removing them creates a giant diff with no behavioural change."
- Dropping the v1 Mongo `rules` / `rule_events` collections on a live database. Per ADR 0016 pillar #12, that's an operator action, not a code change.
- Adding a startup migration to drop the collection (explicitly rejected by ADR 0016).
- Renaming the v2 Mongo collections (`rules_v2`, `rule_events_v2`) — they keep their names; renaming would require either a migration or a data wipe.
- The v2 directory layout itself (still `packages/engine/src/rules/`). Only the web URL + folder pair (`rules/` → `rules/`) move so the URL no longer leaks the v2 origin.

## Surprises

(Filled in after implementation.)
