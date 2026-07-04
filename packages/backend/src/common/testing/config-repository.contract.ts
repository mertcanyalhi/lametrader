import { ConfigKey, type ConfigRepository } from '@lametrader/core';

/**
 * The shared behavioural contract every {@link ConfigRepository} must satisfy.
 *
 * Run against the in-memory adapter in the unit tier and the Mongoose adapter in
 * the e2e (Testcontainers) tier. Both are dumb key-value stores: same
 * behaviour, no config knowledge — so the contract pins get/set, not config
 * shape (that lives in `ConfigService`).
 *
 * Uses Jest's ambient globals (`it`, `expect`); the caller wraps the calls in a
 * `describe`. This file lives under `testing/` and is excluded from the `tsc`
 * build, exactly like the co-located `.spec.ts` suites.
 *
 * @param make - builds a fresh, empty repository under test.
 */
export function runConfigRepositoryContract(
  make: () => ConfigRepository | Promise<ConfigRepository>,
): void {
  it('get returns undefined for a key that was never set', async () => {
    const repo = await make();
    expect(await repo.get(ConfigKey.Periods)).toBeUndefined();
  });

  it('set then get round-trips the stored value', async () => {
    const repo = await make();
    await repo.set(ConfigKey.Periods, ['1h', '4h', '1d']);
    expect(await repo.get(ConfigKey.Periods)).toEqual(['1h', '4h', '1d']);
  });

  it('set replaces the value at an existing key', async () => {
    const repo = await make();
    await repo.set(ConfigKey.DefaultPeriod, '4h');
    await repo.set(ConfigKey.DefaultPeriod, '1d');
    expect(await repo.get(ConfigKey.DefaultPeriod)).toEqual('1d');
  });

  it('keys are independent (setting one leaves the other absent)', async () => {
    const repo = await make();
    await repo.set(ConfigKey.Periods, ['1h']);
    expect(await repo.get(ConfigKey.DefaultPeriod)).toBeUndefined();
  });
}
