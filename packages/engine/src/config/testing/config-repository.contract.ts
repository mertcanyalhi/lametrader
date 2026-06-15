import { type Config, type ConfigRepository, Period } from '@lametrader/core';
import { expect, it } from 'vitest';

/** A valid config (declared-order periods + a default within them). */
const config: Config = {
  periods: [Period.OneHour, Period.FourHours, Period.OneDay],
  defaultPeriod: Period.FourHours,
};

/** A second, distinct config to prove `save` replaces the singleton. */
const other: Config = {
  periods: [Period.OneDay, Period.OneWeek],
  defaultPeriod: Period.OneWeek,
};

/**
 * The shared behavioural contract every {@link ConfigRepository} must satisfy.
 *
 * Run against the in-memory adapter in the unit tier and the Mongo adapter in the e2e tier.
 *
 * @param make - builds a fresh, empty repository under test.
 */
export function runConfigRepositoryContract(
  make: () => ConfigRepository | Promise<ConfigRepository>,
): void {
  it('load returns null before anything is saved', async () => {
    const repo = await make();
    expect(await repo.load()).toBeNull();
  });

  it('save then load round-trips the config', async () => {
    const repo = await make();
    await repo.save(config);
    expect(await repo.load()).toEqual(config);
  });

  it('save replaces the singleton (load reflects the latest save)', async () => {
    const repo = await make();
    await repo.save(config);
    await repo.save(other);
    expect(await repo.load()).toEqual(other);
  });
}
