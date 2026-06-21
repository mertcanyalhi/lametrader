import { Period } from './config.types.js';
import { type Trigger, TriggerKind } from './trigger.types.js';

/**
 * Default minimum interval for {@link TriggerKind.OncePerMinute} — 60 000 ms.
 */
export const DEFAULT_TRIGGER_INTERVAL_MS = 60_000;

/**
 * Thrown when a {@link Trigger} payload is invalid — a bar-based trigger is
 * missing its `period`, or `intervalMs` is negative.
 *
 * Caught at the API/CLI boundary so user-facing errors surface as 400s.
 */
export class TriggerError extends Error {
  /**
   * @param message - human-readable reason.
   */
  constructor(message: string) {
    super(message);
    this.name = 'TriggerError';
  }
}

/**
 * Validate a {@link Trigger}'s per-variant payload.
 *
 * - `OncePerBar` / `OncePerBarClose` require `period` to be a known
 *   {@link Period}.
 * - `OncePerMinute` requires `intervalMs` to be a finite, non-negative number.
 * - `Once` has no payload to validate.
 *
 * @param trigger - the trigger to check.
 * @throws {TriggerError} when the payload is invalid.
 */
export function validateTrigger(trigger: Trigger): void {
  switch (trigger.kind) {
    case TriggerKind.Once:
      return;
    case TriggerKind.OncePerBar:
    case TriggerKind.OncePerBarClose:
      if (!Object.values(Period).includes(trigger.period)) {
        throw new TriggerError(`'${trigger.kind}' trigger requires a valid 'period'.`);
      }
      return;
    case TriggerKind.OncePerMinute:
      if (!Number.isFinite(trigger.intervalMs) || trigger.intervalMs < 0) {
        throw new TriggerError(
          `'${trigger.kind}' trigger 'intervalMs' must be a non-negative number.`,
        );
      }
      return;
  }
}
