import { type Config, Period } from './config.types.js';

/**
 * Raised when a config fails validation. Distinct type so driving adapters can
 * map it to a client error (e.g. HTTP 400) rather than a server fault.
 */
export class ConfigError extends Error {
  /**
   * The config field the failure concerns (e.g. `'periods'`, `'defaultPeriod'`),
   * when one can be attributed. A free-form string so new fields can be tagged
   * without widening a union here; consumers match the values they care about.
   */
  readonly field?: string;
  /**
   * @param message - the human-readable validation failure reason.
   * @param field - the offending config field, when attributable.
   */
  constructor(message: string, field?: string) {
    super(message);
    this.name = 'ConfigError';
    this.field = field;
  }
}

/**
 * Every valid period string, for membership checks.
 */
const PERIOD_VALUES = new Set<string>(Object.values(Period));

/**
 * The config used when nothing has been persisted yet.
 */
export function defaultConfig(): Config {
  return { periods: [Period.OneHour, Period.OneDay], defaultPeriod: Period.OneDay };
}

/**
 * Narrow an unknown value to a {@link Period}, throwing if it is not supported.
 * The thrown error is tagged with {@link field} so callers can attribute it.
 */
function toPeriod(value: unknown, field: string): Period {
  if (typeof value !== 'string' || !PERIOD_VALUES.has(value)) {
    throw new ConfigError(`unsupported period: ${String(value)}`, field);
  }
  return value as Period;
}

/**
 * Validate and normalize an unknown input into a {@link Config}. Throws on an
 * empty list, an unsupported or duplicate period, a missing/empty
 * `defaultPeriod`, or a `defaultPeriod` that is not among `periods`. Every
 * {@link ConfigError} carries the `field` it concerns.
 */
export function parseConfig(input: unknown): Config {
  const obj = (input ?? {}) as { periods?: unknown; defaultPeriod?: unknown };
  if (!Array.isArray(obj.periods)) {
    throw new ConfigError('periods must be an array', 'periods');
  }
  if (obj.periods.length === 0) {
    throw new ConfigError('periods must not be empty', 'periods');
  }
  const periods: Period[] = [];
  for (const raw of obj.periods) {
    const period = toPeriod(raw, 'periods');
    if (periods.includes(period)) {
      throw new ConfigError(`duplicate period: ${period}`, 'periods');
    }
    periods.push(period);
  }
  if (typeof obj.defaultPeriod !== 'string' || obj.defaultPeriod === '') {
    throw new ConfigError('defaultPeriod must not be empty', 'defaultPeriod');
  }
  const defaultPeriod = toPeriod(obj.defaultPeriod, 'defaultPeriod');
  if (!periods.includes(defaultPeriod)) {
    throw new ConfigError(`defaultPeriod ${defaultPeriod} is not in periods`, 'defaultPeriod');
  }
  return { periods, defaultPeriod };
}

/**
 * Apply a partial update over a current config and revalidate the result.
 * Fields absent from `patch` are taken from `current`.
 */
export function mergeConfig(
  current: Config,
  patch: { periods?: unknown; defaultPeriod?: unknown },
): Config {
  return parseConfig({
    periods: patch.periods ?? current.periods,
    defaultPeriod: patch.defaultPeriod ?? current.defaultPeriod,
  });
}
