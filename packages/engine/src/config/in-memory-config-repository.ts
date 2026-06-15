import type { Config, ConfigRepository } from '@lametrader/core';

/**
 * A {@link ConfigRepository} backed by a single in-memory slot.
 *
 * Real (not a test double): backs the unit tier and offline/demo wiring, replacing the ad-hoc `{ load, save }` stubs scattered through the tests.
 */
export class InMemoryConfigRepository implements ConfigRepository {
  /**
   * The stored singleton config, or `null` until first saved.
   */
  private current: Config | null;

  /**
   * @param seed - an initial config to pre-populate with (default: none stored).
   */
  constructor(seed: Config | null = null) {
    this.current = seed;
  }

  async load(): Promise<Config | null> {
    return this.current;
  }

  async save(config: Config): Promise<void> {
    this.current = config;
  }
}
