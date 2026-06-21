import { type Action, ActionKind } from './action.types.js';

/**
 * Thrown when an {@link Action} payload is invalid — empty `key`,
 * `destinationName`, or `template`.
 *
 * Caught at the API/CLI boundary so user-facing errors surface as 400s.
 */
export class ActionError extends Error {
  /**
   * @param message - human-readable reason.
   */
  constructor(message: string) {
    super(message);
    this.name = 'ActionError';
  }
}

/**
 * Reject empty / whitespace-only strings used as a key, destination, or
 * template.
 */
function requireNonEmpty(value: string, field: string, kind: ActionKind): void {
  if (value.trim() === '') {
    throw new ActionError(`'${kind}' action '${field}' must be a non-empty string.`);
  }
}

/**
 * Validate an {@link Action}'s per-variant payload.
 *
 * - State mutations require a non-empty `key`.
 * - `NotifyTelegram` requires a non-empty `destinationName` and `template`.
 *
 * @param action - the action to check.
 * @throws {ActionError} when the payload is invalid.
 */
export function validateAction(action: Action): void {
  switch (action.kind) {
    case ActionKind.SetSymbolState:
    case ActionKind.SetGlobalState:
      requireNonEmpty(action.key, 'key', action.kind);
      return;
    case ActionKind.RemoveSymbolState:
    case ActionKind.RemoveGlobalState:
      requireNonEmpty(action.key, 'key', action.kind);
      return;
    case ActionKind.NotifyTelegram:
      requireNonEmpty(action.destinationName, 'destinationName', action.kind);
      requireNonEmpty(action.template, 'template', action.kind);
      return;
  }
}
