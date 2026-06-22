# Spec: rule-event appender for state actions

- Status: implemented
- Touches: `engine` (`packages/engine/src/rules/event-appender.ts`, `packages/engine/src/rules/in-memory-event-log.ts`).

## Goal

Append one `RuleEventEntry` for a state-mutation action to BOTH the rule's embedded events log AND the affected symbol's embedded events log (per ADR 0012).
Picks the right event variant from the action's `kind` — `Set*` actions become `StateSet` entries with `scope`/`key`/`value`, `Remove*` actions become `StateRemoved` entries with `scope`/`key`.

## Acceptance criteria

- [ ] `SetSymbolState` appends a `StateSet` entry with `StateScope.Symbol` to both the rule log and the symbol log.
- [ ] `SetGlobalState` appends a `StateSet` entry with `StateScope.Global` to both the rule log and the symbol log.
- [ ] `RemoveSymbolState` appends a `StateRemoved` entry with `StateScope.Symbol` to both the rule log and the symbol log.
- [ ] `RemoveGlobalState` appends a `StateRemoved` entry with `StateScope.Global` to both the rule log and the symbol log.
- [ ] `InMemoryEventLog` preserves append order across multiple appends to the same rule.
- [ ] `InMemoryEventLog` isolates events between rules and between symbols — appends to one rule/symbol do not surface on another.
