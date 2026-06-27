import { type Action, ActionKind } from './action.types.js';
import { DESTINATION_NAME_MAX, STATE_KEY_MAX, TELEGRAM_TEMPLATE_MAX } from './limits.js';

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
 * Reject strings longer than `max`.
 */
function requireMaxLength(value: string, field: string, kind: ActionKind, max: number): void {
  if (value.length > max) {
    throw new ActionError(`'${kind}' action '${field}' must be ${max} characters or fewer.`);
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
      requireMaxLength(action.key, 'key', action.kind, STATE_KEY_MAX);
      return;
    case ActionKind.RemoveSymbolState:
    case ActionKind.RemoveGlobalState:
      requireNonEmpty(action.key, 'key', action.kind);
      requireMaxLength(action.key, 'key', action.kind, STATE_KEY_MAX);
      return;
    case ActionKind.NotifyTelegram:
      requireNonEmpty(action.destinationName, 'destinationName', action.kind);
      requireMaxLength(
        action.destinationName,
        'destinationName',
        action.kind,
        DESTINATION_NAME_MAX,
      );
      requireNonEmpty(action.template, 'template', action.kind);
      requireMaxLength(action.template, 'template', action.kind, TELEGRAM_TEMPLATE_MAX);
      return;
  }
}
