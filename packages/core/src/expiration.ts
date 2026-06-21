import type { Expiration } from './expiration.types.js';

/**
 * Thrown when an {@link Expiration} is invalid — currently, when `at` is not in
 * the future relative to the supplied `now`.
 *
 * Caught at the API/CLI boundary so user-facing errors surface as 400s.
 */
export class ExpirationError extends Error {
  /**
   * @param message - human-readable reason.
   */
  constructor(message: string) {
    super(message);
    this.name = 'ExpirationError';
  }
}

/**
 * Validate an {@link Expiration} at rule-creation time.
 *
 * - `null` is always accepted (never expires).
 * - A value's `at` must be a finite epoch-ms strictly greater than `now`.
 *
 * @param expiration - the policy to check.
 * @param now - the reference instant (epoch ms); injected so callers stay
 *   pure / testable.
 * @throws {ExpirationError} when `at` is not in the future.
 */
export function validateExpiration(expiration: Expiration, now: number): void {
  if (expiration === null) return;

  if (!Number.isFinite(expiration.at) || expiration.at <= now) {
    throw new ExpirationError("Expiration 'at' must be a future epoch-ms instant.");
  }
}
