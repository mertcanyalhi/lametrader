/**
 * The app-wide HTTP error contract.
 *
 * Every error the API surfaces — a mapped domain failure, a DTO validation
 * rejection, or an unexpected fault — serializes to {@link ErrorResponse}, the
 * uniform `{ error, fields? }` envelope the web client and every ported e2e
 * suite assert against byte-for-byte.
 * Established here as the keystone so every later resource reuses it unchanged.
 */

/**
 * One field-level failure inside an {@link ErrorResponse.fields} array.
 *
 * Emitted by the validation pipe (one per failing constraint) and by the
 * field-carrying domain errors (e.g. an unwatched-symbol tick-eligibility
 * failure).
 * `path` is the dotted body path (`scope.symbolId`); `message` is the
 * human-readable reason.
 */
export interface FieldError {
  /** The dotted path to the offending field (`''` for the body root). */
  path: string;
  /** The human-readable failure reason for this field. */
  message: string;
}

/**
 * The uniform error response body.
 *
 * `error` is always present — a single human-readable summary.
 * `fields` is additive: present only for validation-style failures that carry
 * per-field detail (DTO validation, tick-eligibility), absent otherwise, so a
 * simple `{ error }` failure stays byte-identical to today's contract.
 */
export interface ErrorResponse {
  /** The human-readable error summary. */
  error: string;
  /** Optional per-field failures; present only for validation-style errors. */
  fields?: FieldError[];
}
