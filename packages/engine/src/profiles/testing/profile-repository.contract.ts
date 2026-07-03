import { type Profile, type ProfileRepository, ProfileScope } from '@lametrader/core';
import { expect, it } from 'vitest';

/** Build a simple `All`-scoped profile for the contract. */
const profile = (id: string, name = id): Profile => ({
  id,
  name,
  description: '',
  enabled: true,
  scope: { type: ProfileScope.All },
  createdAt: 1000,
  updatedAt: 1000,
  indicators: [],
  chartStates: [],
});

/** Sort by id so list assertions are order-independent across adapters. */
const byId = (a: Profile, b: Profile): number => a.id.localeCompare(b.id);

/**
 * The shared behavioural contract every {@link ProfileRepository} must satisfy.
 *
 * Run against the in-memory adapter in the unit tier and the Mongo adapter in the e2e tier.
 *
 * @param make - builds a fresh, empty repository under test.
 */
export function runProfileRepositoryContract(
  make: () => ProfileRepository | Promise<ProfileRepository>,
): void {
  it('save then get round-trips the profile', async () => {
    const repo = await make();
    await repo.save(profile('p1'));
    expect(await repo.get('p1')).toEqual(profile('p1'));
  });

  it('list returns all saved profiles', async () => {
    const repo = await make();
    await repo.save(profile('p1'));
    await repo.save(profile('p2'));
    expect((await repo.list()).sort(byId)).toEqual([profile('p1'), profile('p2')]);
  });

  it('save replaces by id (no duplicate)', async () => {
    const repo = await make();
    await repo.save(profile('p1', 'first'));
    await repo.save(profile('p1', 'second'));
    expect(await repo.list()).toEqual([profile('p1', 'second')]);
  });

  it('get returns null for an unknown id', async () => {
    const repo = await make();
    expect(await repo.get('nope')).toBeNull();
  });

  it('remove deletes, and is a no-op for an unknown id', async () => {
    const repo = await make();
    await repo.save(profile('p1'));
    await repo.remove('p1');
    await repo.remove('p1');
    expect(await repo.get('p1')).toBeNull();
  });
}
