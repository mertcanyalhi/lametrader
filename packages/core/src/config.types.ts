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
 * Port for persisting the singleton {@link Config}. Implemented by driven
 * adapters (e.g. MongoDB); faked in the unit tier.
 */
export interface ConfigRepository {
  /**
   * Load the persisted config, or `null` if none has been stored yet.
   */
  load(): Promise<Config | null>;
  /**
   * Persist (replace) the singleton config.
   */
  save(config: Config): Promise<void>;
}
