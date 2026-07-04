# Spec: rules table columns

- Status: draft
- Touches: `@lametrader/core` (Rule schema), `@lametrader/engine` (orchestrator stamping), `@lametrader/api` (response schema), `@lametrader/ui` (RulesTable + RulesPage).

## Goal

Replace the card-based rules list on `/rules` with a real management table — six columns (play/pause, Name + Active/Inactive, Scope, Trigger, Last fired, Actions).
The shared `RulesTable` component takes a `columns` config prop so the Charts-page modal (#427) can reuse it with `Scope` omitted.

A `lastFiredAt?: number` field is added to the `Rule` schema (per #426 settled decision A); the orchestrator stamps it on every fire so the column reads from a single fetch (no N+1).

## Acceptance criteria

Each bullet maps to exactly one test.

### Domain + orchestrator (`@lametrader/core`, `@lametrader/engine`)

- [ ] `Rule.lastFiredAt` is optional and round-trips through `InMemoryRuleRepository.save` / `get`.
- [ ] `Rule.lastFiredAt` round-trips through `MongoRuleRepository.save` / `get`.
- [ ] After `RuleOrchestrator.process` fires a rule, the persisted rule has `lastFiredAt` equal to the inbound event's `ts`.
- [ ] When `RuleOrchestrator.process` runs an event but no rule fires, `lastFiredAt` is left unchanged.

### Web (`@lametrader/ui`)

- [ ] `RulesTable` renders six column headers in the default config: `(empty)`, `Name`, `Scope`, `Trigger`, `Last fired`, `Actions`.
- [ ] `RulesTable` with `columns={{ scope: false }}` omits the `Scope` header and cell.
- [ ] The Name cell shows the rule name and a colored badge reading `Active` when `enabled` is `true`.
- [ ] The Name cell badge reads `Inactive` when `enabled` is `false`.
- [ ] The Scope cell reads `Single <symbolId>` for a `Symbol`-scoped rule.
- [ ] The Scope cell reads `Multiple <count>` for a `Symbols(list)`-scoped rule.
- [ ] The Scope cell reads `All` for an `AllSymbols`-scoped rule.
- [ ] The Trigger cell reads `Once per bar (1m)` for `{ kind: OncePerBar, period: OneMinute }` (composite kind + period in parens).
- [ ] The Trigger cell reads `Every time` for `{ kind: EveryTime }` (no parenthesis when no period/intervalMs).
- [ ] The Trigger cell reads `Once per interval (60000ms)` for `{ kind: OncePerInterval, intervalMs: 60_000 }`.
- [ ] The Last fired cell reads `Never` when `lastFiredAt` is undefined.
- [ ] The Last fired cell renders the formatted timestamp when `lastFiredAt` is set.
- [ ] Clicking the play/pause toggle calls `usePatchRule` with `{ patch: { enabled: !current } }`.
- [ ] Clicking the Edit action invokes the `onEdit(rule)` callback.
- [ ] Clicking the Events action invokes the `onEvents(rule)` callback.
- [ ] Clicking the Delete action and confirming calls `useDeleteRule().mutate(rule.id)`.
- [ ] Cancelling the Delete confirmation does NOT call `useDeleteRule`.

## End-to-end expectation

`packages/engine/tests/e2e/rules-orchestrator.e2e.test.ts` already exercises the orchestrator's fire path against Mongo.
Extend the closest persistence e2e (in `packages/engine/tests/e2e/rules-persistence.e2e.test.ts` if present, otherwise the rules-rest e2e under `packages/api`) so a fired rule's `lastFiredAt` is observable through `GET /rules/:id`.

## Out of scope

- Sorting / filtering / search on the rules table (separate issue).
- Pagination of rules — fetch + render in one shot at the current rule counts.
- The Charts-page reuse (#427) — only the `columns` config prop ships here.

## Surprises

(filled in retroactively)
