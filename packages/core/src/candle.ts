import type { BackfillRange } from './candle.types.js';
import { Period } from './config.types.js';

/**
 * The fixed duration of each {@link Period}, in milliseconds. Lets callers
 * decide whether a candle's bar has closed (`time + periodMillis(period) <= now`).
 */
const PERIOD_MILLIS: Record<Period, number> = {
  [Period.OneMinute]: 60_000,
  [Period.FiveMinutes]: 300_000,
  [Period.FifteenMinutes]: 900_000,
  [Period.ThirtyMinutes]: 1_800_000,
  [Period.OneHour]: 3_600_000,
  [Period.FourHours]: 14_400_000,
  [Period.OneDay]: 86_400_000,
  [Period.OneWeek]: 604_800_000,
};

/**
 * The fixed duration of a {@link Period} in milliseconds.
 *
 * @param period - the period to measure.
 */
export function periodMillis(period: Period): number {
  return PERIOD_MILLIS[period];
}

/**
 * Default number of candles per page when a read omits `limit`.
 */
export const DEFAULT_CANDLE_LIMIT = 100;

/**
 * Maximum candles per page a read may request.
 */
export const MAX_CANDLE_LIMIT = 1000;

/**
 * Raised when candle/backfill input fails validation (bad range, or a period not
 * watched for the symbol). Distinct type so driving adapters map it to a client
 * error (HTTP 400) rather than a server fault.
 */
export class CandleError extends Error {
  /**
   * @param message - the human-readable validation failure reason.
   */
  constructor(message: string) {
    super(message);
    this.name = 'CandleError';
  }
}

/**
 * Raised when a backfill is requested for a symbol+period that already has a
 * running backfill job. Distinct type so driving adapters map it to HTTP 409
 * (the resource is busy) rather than a generic error.
 */
export class BackfillConflictError extends Error {
  /**
   * @param message - the human-readable conflict reason.
   */
  constructor(message: string) {
    super(message);
    this.name = 'BackfillConflictError';
  }
}

/**
 * Validate and normalize an optional backfill-range input into a
 * {@link BackfillRange}, or `undefined` to mean "the provider's deepest history".
 *
 * @param input - `{ from, to }` epoch-ms bounds, or `undefined`/`null`.
 * @throws {@link CandleError} when `from`/`to` is not a finite number, or `from >= to`.
 */
export function parseBackfillRange(
  input: { from?: unknown; to?: unknown } | undefined | null,
): BackfillRange | undefined {
  if (input === undefined || input === null) {
    return undefined;
  }
  const { from, to } = input;
  if (typeof from !== 'number' || !Number.isFinite(from)) {
    throw new CandleError(`backfill range "from" must be a finite number: ${String(from)}`);
  }
  if (typeof to !== 'number' || !Number.isFinite(to)) {
    throw new CandleError(`backfill range "to" must be a finite number: ${String(to)}`);
  }
  if (from >= to) {
    throw new CandleError(`backfill range "from" (${from}) must be before "to" (${to})`);
  }
  return { from, to };
}

/**
 * Validate and normalize an optional candle-page `limit`: a positive integer no
 * greater than {@link MAX_CANDLE_LIMIT}, defaulting to {@link DEFAULT_CANDLE_LIMIT}
 * when omitted.
 *
 * @param input - the raw limit value, or `undefined`/`null` for the default.
 * @throws {@link CandleError} on a non-integer, a value `< 1`, or one above the max.
 */
export function parseCandleLimit(input: unknown): number {
  if (input === undefined || input === null) {
    return DEFAULT_CANDLE_LIMIT;
  }
  if (typeof input !== 'number' || !Number.isInteger(input) || input < 1) {
    throw new CandleError(`limit must be a positive integer: ${String(input)}`);
  }
  if (input > MAX_CANDLE_LIMIT) {
    throw new CandleError(`limit must not exceed ${MAX_CANDLE_LIMIT}: ${input}`);
  }
  return input;
}
