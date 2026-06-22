# Spec: `Once` trigger gate

- Status: implemented
- Touches: `engine` (`packages/engine/src/rules/once-trigger-gate.ts`).

## Goal

The `Once` trigger gate — returns `true` when a rule may fire on `symbolId` (no prior `Fired` event exists on the rule's embedded events log for that `symbolId`).
The events log is part of the persisted `Rule` entity (ADR 0012), so the survives-restart guarantee comes for free from the rule persistence adapter.

## Acceptance criteria

- [ ] Returns `true` when the events log is empty.
- [ ] Returns `false` when a `Fired` event for the same symbol already exists.
- [ ] Returns `true` when no `Fired` event exists for the queried symbol (a different symbol's firing does not gate).
- [ ] Ignores non-`Fired` events — a `CycleOverflow` entry does not gate.
