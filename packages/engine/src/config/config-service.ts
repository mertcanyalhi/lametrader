import {
  type Config,
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
   * @param repo - the configuration persistence port.
   */
  constructor(repo: ConfigRepository) {
    this.repo = repo;
  }

  /**
   * Return the persisted config, or the default when nothing is stored yet.
   */
  async get(): Promise<Config> {
    return (await this.repo.load()) ?? defaultConfig();
  }

  /**
   * Fully replace the config (PUT). Validates the input, persists it, and
   * returns the stored value; persists nothing if validation fails.
   */
  async replace(input: unknown): Promise<Config> {
    const config = parseConfig(input);
    await this.repo.save(config);
    return config;
  }

  /**
   * Partially update the config (PATCH). Merges the patch over the current
   * config, validates the result, persists it, and returns it; persists
   * nothing if the merged result is invalid.
   */
  async patch(input: { periods?: unknown; defaultPeriod?: unknown }): Promise<Config> {
    const merged = mergeConfig(await this.get(), input);
    await this.repo.save(merged);
    return merged;
  }
}
