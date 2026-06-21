import type { ConfigKey, ConfigRepository } from '@lametrader/core';

/**
 * A {@link ConfigRepository} backed by an in-memory map.
 *
 * Real (not a test double): backs the unit tier and offline/demo wiring, replacing the ad-hoc `{ get, set }` stubs scattered through the tests.
 */
export class InMemoryConfigRepository implements ConfigRepository {
  /**
   * The stored key-value pairs.
   */
  private readonly store: Map<ConfigKey, unknown>;

  /**
   * @param seed - initial key-value pairs to pre-populate with (default: empty).
   */
  constructor(seed: Iterable<readonly [ConfigKey, unknown]> = []) {
    this.store = new Map(seed);
  }

  async get(key: ConfigKey): Promise<unknown> {
    return this.store.get(key);
  }

  async set(key: ConfigKey, value: unknown): Promise<void> {
    this.store.set(key, value);
  }
}
