# Spec: state-mutation action executor

- Status: implemented
- Touches: `engine` (`packages/engine/src/rules/state-action-executor.ts`).

## Goal

Execute a single state-mutation action (`SetSymbolState`, `RemoveSymbolState`, `SetGlobalState`, `RemoveGlobalState`) via the `StateRepository`.
Each write produces a `stateChanged` event on the repository's channel, which the orchestrator's cascade loop picks up and re-enters the engine with.

## Acceptance criteria

- [ ] `SetSymbolState` writes the tagged value to the firing symbol and emits a `stateChanged` event with `prev: null` and the new tagged value as `current` at the action's `ts`.
- [ ] `RemoveSymbolState` removes the key on the firing symbol and emits a `stateChanged` event with the previous tagged value as `prev` and `current: null`.
- [ ] `SetGlobalState` writes the tagged value to the global scope and emits a `stateChanged` event scoped to `StateScope.Global`.
- [ ] `RemoveGlobalState` removes the global key and emits a `stateChanged` event with the previous tagged value as `prev` and `current: null` in the `Global` scope.
