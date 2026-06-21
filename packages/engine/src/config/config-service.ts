import {
  type Config,
  ConfigKey,
  type ConfigRepository,
  defaultConfig,
  mergeConfig,
  parseConfig,
} from '@lametrader/core';

/**
 * Application use-case for reading and changing the global {@link Config}.
 *
 * Depends only on the {@link ConfigRepository} port; the concrete store is
 * injected (Mongo in production, a fake in unit tests).
 */
export class ConfigService {
  /**
   * The persistence port this service reads from and writes to.
   */
  private readonly repo: ConfigRepository;

  /**
   * The last-seen config, memoized to avoid re-reading the store on every
   * {@link get}. Populated on first read, overwritten on every write.
   *
   * ponytail: per-process memo. Config is read-often/write-rarely and every
   * write here refreshes it, so a single instance is always fresh. With
   * multiple API instances, one won't see another's change until restart —
   * acceptable for config; add a TTL or change-stream invalidation if not.
   */
  private cached: Config | undefined;

  /**
   * @param repo - the configuration persistence port.
   */
  constructor(repo: ConfigRepository) {
    this.repo = repo;
  }

  /**
   * Return the persisted config, or the default when nothing is stored yet.
   * Assembles the config from its key-value fields and validates the result, so
   * partial or corrupt stored state surfaces as a `ConfigError` rather than a
   * malformed `Config`. Memoized after the first read.
   */
  async get(): Promise<Config> {
    if (this.cached !== undefined) {
      return this.cached;
    }
    const periods = await this.repo.get(ConfigKey.Periods);
    const defaultPeriod = await this.repo.get(ConfigKey.DefaultPeriod);
    const config =
      periods === undefined && defaultPeriod === undefined
        ? defaultConfig()
        : parseConfig({ periods, defaultPeriod });
    this.cached = config;
    return config;
  }

  /**
   * Fully replace the config (PUT). Validates the input, persists it, and
   * returns the stored value; persists nothing if validation fails.
   */
  async replace(input: unknown): Promise<Config> {
    const config = parseConfig(input);
    await this.store(config);
    return config;
  }

  /**
   * Partially update the config (PATCH). Merges the patch over the current
   * config, validates the result, persists it, and returns it; persists
   * nothing if the merged result is invalid.
   */
  async patch(input: { periods?: unknown; defaultPeriod?: unknown }): Promise<Config> {
    const merged = mergeConfig(await this.get(), input);
    await this.store(merged);
    return merged;
  }

  /**
   * Write a validated config out across its key-value fields and refresh the
   * memo so a subsequent {@link get} sees the new value without a re-read.
   */
  private async store(config: Config): Promise<void> {
    await this.repo.set(ConfigKey.Periods, config.periods);
    await this.repo.set(ConfigKey.DefaultPeriod, config.defaultPeriod);
    this.cached = config;
  }
}
