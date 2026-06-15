import {
  Period,
  type Profile,
  ProfileConflictError,
  ProfileError,
  ProfileNotFoundError,
  ProfileScope,
  SymbolType,
  type WatchedSymbol,
} from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { InMemoryWatchlistRepository } from '../symbols/in-memory-watchlist-repository.js';
import { InMemoryProfileRepository } from './in-memory-profile-repository.js';
import { ProfileService } from './profile-service.js';

/** A watched crypto symbol for scope-validation tests. */
const watched = (id: string): WatchedSymbol => ({
  id,
  type: SymbolType.Crypto,
  description: id,
  exchange: 'Binance',
  periods: [Period.OneHour],
});

/** Deterministic id generator: p1, p2, … */
function sequentialIds(): () => string {
  let n = 0;
  return () => `p${++n}`;
}

/** Build a service over fresh in-memory repos with injectable clock. */
function build(clock = { value: 1000 }, seedWatched: string[] = []) {
  const profiles = new InMemoryProfileRepository();
  const watchlist = new InMemoryWatchlistRepository(seedWatched.map(watched));
  const service = new ProfileService(profiles, watchlist, {
    newId: sequentialIds(),
    now: () => clock.value,
  });
  return { service, profiles, watchlist };
}

describe('ProfileService.create', () => {
  it('builds a profile with generated id, timestamps, and defaults, and persists it', async () => {
    const { service, profiles } = build();
    const created = await service.create({ name: 'Scalper' });
    expect(created).toEqual({
      id: 'p1',
      name: 'Scalper',
      description: '',
      enabled: true,
      scope: { type: ProfileScope.All },
      createdAt: 1000,
      updatedAt: 1000,
    });
    expect(await profiles.list()).toEqual([created]);
  });

  it('throws ProfileConflictError on a duplicate name and persists nothing', async () => {
    const { service, profiles } = build();
    await service.create({ name: 'Scalper' });
    await expect(service.create({ name: 'Scalper' })).rejects.toBeInstanceOf(ProfileConflictError);
    expect((await profiles.list()).length).toBe(1);
  });

  it('rejects a symbols scope with an unwatched id and persists nothing', async () => {
    const { service, profiles } = build({ value: 1000 }, ['crypto:BTCUSDT']);
    await expect(
      service.create({
        name: 'Subset',
        scope: { type: 'symbols', symbolIds: ['crypto:ETHUSDT'] },
      }),
    ).rejects.toBeInstanceOf(ProfileError);
    expect(await profiles.list()).toEqual([]);
  });
});

describe('ProfileService.get', () => {
  it('returns the stored profile and throws ProfileNotFoundError for an unknown id', async () => {
    const { service } = build();
    const created = await service.create({ name: 'Scalper' });
    expect(await service.get('p1')).toEqual(created);
    await expect(service.get('nope')).rejects.toBeInstanceOf(ProfileNotFoundError);
  });
});

describe('ProfileService.replace', () => {
  it('fully replaces mutable fields, preserving id+createdAt and bumping updatedAt', async () => {
    const clock = { value: 1000 };
    const { service } = build(clock);
    await service.create({ name: 'Scalper', description: 'fast', enabled: true });
    clock.value = 2000;
    const replaced = await service.replace('p1', { name: 'Swing' });
    expect(replaced).toEqual({
      id: 'p1',
      name: 'Swing',
      description: '',
      enabled: true,
      scope: { type: ProfileScope.All },
      createdAt: 1000,
      updatedAt: 2000,
    });
  });
});

describe('ProfileService.update', () => {
  it('patches only the provided fields, keeping the rest', async () => {
    const clock = { value: 1000 };
    const { service } = build(clock);
    await service.create({ name: 'Scalper', description: 'fast' });
    clock.value = 2000;
    const updated = await service.update('p1', { enabled: false });
    expect(updated).toEqual({
      id: 'p1',
      name: 'Scalper',
      description: 'fast',
      enabled: false,
      scope: { type: ProfileScope.All },
      createdAt: 1000,
      updatedAt: 2000,
    });
  });
});

describe('ProfileService.remove', () => {
  it('deletes the profile, and throws ProfileNotFoundError for an unknown id', async () => {
    const { service, profiles } = build();
    await service.create({ name: 'Scalper' });
    await service.remove('p1');
    expect(await profiles.list()).toEqual([]);
    await expect(service.remove('p1')).rejects.toBeInstanceOf(ProfileNotFoundError);
  });
});

describe('ProfileService.pruneSymbol', () => {
  it('removes a symbol from subsets and disables a now-empty one (stays symbols-scoped)', async () => {
    const clock = { value: 1000 };
    const { service, profiles } = build(clock, ['crypto:BTCUSDT', 'crypto:ETHUSDT']);
    await service.create({
      name: 'Both',
      scope: { type: 'symbols', symbolIds: ['crypto:BTCUSDT', 'crypto:ETHUSDT'] },
    });
    await service.create({
      name: 'OnlyBtc',
      scope: { type: 'symbols', symbolIds: ['crypto:BTCUSDT'] },
    });
    clock.value = 2000;

    await service.pruneSymbol('crypto:BTCUSDT');

    expect(await profiles.list()).toEqual<Profile[]>([
      {
        id: 'p1',
        name: 'Both',
        description: '',
        enabled: true,
        scope: { type: ProfileScope.Symbols, symbolIds: ['crypto:ETHUSDT'] },
        createdAt: 1000,
        updatedAt: 2000,
      },
      {
        id: 'p2',
        name: 'OnlyBtc',
        description: '',
        enabled: false,
        scope: { type: ProfileScope.Symbols, symbolIds: [] },
        createdAt: 1000,
        updatedAt: 2000,
      },
    ]);
  });
});
