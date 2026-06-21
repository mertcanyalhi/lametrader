/**
 * Supported candle periods — the values common across symbols. Only these are
 * accepted in a {@link Config}; anything else is rejected by `parseConfig`.
 */
export enum Period {
  /** One minute. */
  OneMinute = '1m',
  /** Five minutes. */
  FiveMinutes = '5m',
  /** Fifteen minutes. */
  FifteenMinutes = '15m',
  /** Thirty minutes. */
  ThirtyMinutes = '30m',
  /** One hour. */
  OneHour = '1h',
  /** Four hours. */
  FourHours = '4h',
  /** One day. */
  OneDay = '1d',
  /** One week. */
  OneWeek = '1w',
}

/**
 * The platform's global configuration (a singleton).
 */
export interface Config {
  /**
   * The supported periods, in declared order. Non-empty, no duplicates, each a
   * member of {@link Period}.
   */
  periods: Period[];
  /**
   * The period shown for a symbol by default. Must be one of {@link Config.periods}.
   */
  defaultPeriod: Period;
}

/**
 * The keys under which a {@link Config}'s fields are persisted in the
 * key-value store. One field per key, so the repository stays a dumb store and
 * all assembly/validation lives in the application layer.
 */
export enum ConfigKey {
  /** Holds the `periods` array. */
  Periods = 'periods',
  /** Holds the `defaultPeriod` string. */
  DefaultPeriod = 'defaultPeriod',
}

/**
 * Port for a key-value store the config is persisted in. A dumb store: it knows
 * nothing about {@link Config} shape or validity — assembly and validation are
 * the application layer's job (see `ConfigService`). Implemented by driven
 * adapters (e.g. MongoDB); faked in the unit tier.
 */
export interface ConfigRepository {
  /**
   * Read the value stored at `key`, or `undefined` if nothing is stored there.
   */
  get(key: ConfigKey): Promise<unknown>;
  /**
   * Store (replace) the value at `key`.
   */
  set(key: ConfigKey, value: unknown): Promise<void>;
}
