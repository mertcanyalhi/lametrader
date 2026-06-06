import { type Config, Period } from './config.types.js';

/**
 * Raised when a config fails validation. Distinct type so driving adapters can
 * map it to a client error (e.g. HTTP 400) rather than a server fault.
 */
export class ConfigError extends Error {
  /**
   * @param message - the human-readable validation failure reason.
   */
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
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
 */
function toPeriod(value: unknown): Period {
  if (typeof value !== 'string' || !PERIOD_VALUES.has(value)) {
    throw new ConfigError(`unsupported period: ${String(value)}`);
  }
  return value as Period;
}

/**
 * Validate and normalize an unknown input into a {@link Config}. Throws on an
 * empty list, an unsupported or duplicate period, or a `defaultPeriod` that is
 * not among `periods`.
 */
export function parseConfig(input: unknown): Config {
  const obj = (input ?? {}) as { periods?: unknown; defaultPeriod?: unknown };
  if (!Array.isArray(obj.periods)) {
    throw new ConfigError('periods must be an array');
  }
  if (obj.periods.length === 0) {
    throw new ConfigError('periods must not be empty');
  }
  const periods: Period[] = [];
  for (const raw of obj.periods) {
    const period = toPeriod(raw);
    if (periods.includes(period)) {
      throw new ConfigError(`duplicate period: ${period}`);
    }
    periods.push(period);
  }
  const defaultPeriod = toPeriod(obj.defaultPeriod);
  if (!periods.includes(defaultPeriod)) {
    throw new ConfigError(`defaultPeriod ${defaultPeriod} is not in periods`);
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
