import {
  ActionKind,
  type RemoveGlobalStateAction,
  type RemoveSymbolStateAction,
  type SetGlobalStateAction,
  type SetSymbolStateAction,
  type StateRepository,
} from '@lametrader/core';

/**
 * The subset of {@link Action}s this executor handles — state mutations.
 *
 * Telegram notifications (`NotifyTelegram`) and rule-event appending are
 * handled by their own executors (#126, #127).
 */
export type StateMutationAction =
  | SetSymbolStateAction
  | RemoveSymbolStateAction
  | SetGlobalStateAction
  | RemoveGlobalStateAction;

/**
 * Execute a single state-mutation action via the {@link StateRepository}.
 *
 * Each write produces a `stateChanged` event on the repository's
 * `onStateChanged` channel (per #108), which the orchestrator's cascade loop
 * picks up and re-enters the engine with.
 *
 * @param action - the mutation to apply.
 * @param firingSymbolId - the symbol the firing rule is scoped to; used for
 *   symbol-scoped writes (ignored for global writes).
 * @param ts - the event timestamp the write is recorded at (per ADR 0012).
 * @param state - the state repository to write to.
 */
export async function executeStateAction(
  action: StateMutationAction,
  firingSymbolId: string,
  ts: number,
  state: StateRepository,
): Promise<void> {
  switch (action.kind) {
    case ActionKind.SetSymbolState:
      await state.setSymbolState(firingSymbolId, action.key, action.value, ts);
      return;
    case ActionKind.RemoveSymbolState:
      await state.removeSymbolState(firingSymbolId, action.key, ts);
      return;
    case ActionKind.SetGlobalState:
      await state.setGlobalState(action.key, action.value, ts);
      return;
    case ActionKind.RemoveGlobalState:
      await state.removeGlobalState(action.key, ts);
      return;
  }
}
