import {
  IndicatorError,
  IndicatorInstanceNotFoundError,
  Period,
  type Profile,
  ProfileConflictError,
  ProfileError,
  ProfileNotFoundError,
  ProfileScope,
  SymbolType,
  type WatchedSymbol,
} from '@lametrader/core';
import { defaultIndicators } from '../indicators/default-indicators.js';
import type { IndicatorRegistry } from '../indicators/indicator-registry.js';
import { InMemoryWatchlistRepository } from '../watchlist/in-memory-watchlist.repository.js';
import { InMemoryProfileRepository } from './in-memory-profile.repository.js';
import { ProfileService } from './profile.service.js';
import type { ProfileCascadeRules } from './profile.service.types.js';

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

/**
 * A minimal {@link ProfileCascadeRules} fake recording every `removeForProfile`
 * call — stands in for the (not-yet-ported) rules repository so the delete
 * cascade can be exercised in isolation.
 */
class RecordingCascadeRules implements ProfileCascadeRules {
  /** Profile ids the cascade was invoked for, in call order. */
  readonly removed: string[] = [];

  async removeForProfile(profileId: string): Promise<string[]> {
    this.removed.push(profileId);
    return [];
  }
}

/** Build a service over fresh in-memory repos with injectable clock + the default registry. */
function build(
  clock = { value: 1000 },
  seedWatched: string[] = [],
  registry: IndicatorRegistry = defaultIndicators(),
) {
  const profiles = new InMemoryProfileRepository();
  const watchlist = new InMemoryWatchlistRepository(seedWatched.map(watched));
  const service = new ProfileService(profiles, watchlist, registry, {
    newId: sequentialIds(),
    now: () => clock.value,
  });
  return { service, profiles, watchlist };
}

describe('ProfileService.create', () => {
  it('builds a profile with generated id, timestamps, defaults, and an empty indicators array', async () => {
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
      indicators: [],
      chartStates: [],
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
  it('fully replaces mutable fields, preserves id+createdAt and indicators, bumps updatedAt', async () => {
    const clock = { value: 1000 };
    const { service } = build(clock);
    await service.create({ name: 'Scalper', description: 'fast', enabled: true });
    await service.addIndicator('p1', { indicatorKey: 'sma' });
    clock.value = 2000;
    const replaced = await service.replace('p1', { name: 'Swing' });
    expect(replaced.indicators).toHaveLength(1);
    expect(replaced).toEqual({
      id: 'p1',
      name: 'Swing',
      description: '',
      enabled: true,
      scope: { type: ProfileScope.All },
      createdAt: 1000,
      updatedAt: 2000,
      indicators: replaced.indicators,
      chartStates: [],
    });
  });
});

describe('ProfileService.update', () => {
  it('patches only the provided fields, keeping the rest including indicators', async () => {
    const clock = { value: 1000 };
    const { service } = build(clock);
    await service.create({ name: 'Scalper', description: 'fast' });
    await service.addIndicator('p1', { indicatorKey: 'sma' });
    clock.value = 2000;
    const updated = await service.update('p1', { enabled: false });
    expect(updated.indicators).toHaveLength(1);
    expect(updated).toEqual({
      id: 'p1',
      name: 'Scalper',
      description: 'fast',
      enabled: false,
      scope: { type: ProfileScope.All },
      createdAt: 1000,
      updatedAt: 2000,
      indicators: updated.indicators,
      chartStates: [],
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

  it('cascades to the rules port for the removed profile when it is wired in', async () => {
    const profiles = new InMemoryProfileRepository();
    const watchlist = new InMemoryWatchlistRepository();
    const rules = new RecordingCascadeRules();
    const service = new ProfileService(profiles, watchlist, defaultIndicators(), {
      newId: sequentialIds(),
      now: () => 1000,
      rules,
    });
    await service.create({ name: 'Scalper' });

    await service.remove('p1');

    expect({ removed: rules.removed, profiles: await profiles.list() }).toEqual({
      removed: ['p1'],
      profiles: [],
    });
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
        indicators: [],
        chartStates: [],
      },
      {
        id: 'p2',
        name: 'OnlyBtc',
        description: '',
        enabled: false,
        scope: { type: ProfileScope.Symbols, symbolIds: [] },
        createdAt: 1000,
        updatedAt: 2000,
        indicators: [],
        chartStates: [],
      },
    ]);
  });
});

describe('ProfileService.addIndicator', () => {
  it('appends an instance with generated id, registry version, and defaulted inputs', async () => {
    const { service } = build();
    await service.create({ name: 'Scalper' });
    const instance = await service.addIndicator('p1', { indicatorKey: 'sma' });
    expect(instance).toEqual({
      id: 'p2',
      indicatorKey: 'sma',
      version: 1,
      inputs: { length: 14, source: 'close' },
      summary: 'SMA 14 close',
    });
    const list = await service.listIndicators('p1');
    expect(list).toEqual([instance]);
  });

  it('records explicit inputs and a label', async () => {
    const { service } = build();
    await service.create({ name: 'Scalper' });
    const instance = await service.addIndicator('p1', {
      indicatorKey: 'sma',
      inputs: { length: 5 },
      label: 'Fast',
    });
    expect(instance).toEqual({
      id: 'p2',
      indicatorKey: 'sma',
      version: 1,
      inputs: { length: 5, source: 'close' },
      label: 'Fast',
      summary: 'SMA 5 close',
    });
  });

  it('throws IndicatorError on an unknown indicatorKey and persists nothing', async () => {
    const { service, profiles } = build();
    await service.create({ name: 'Scalper' });
    await expect(service.addIndicator('p1', { indicatorKey: 'bogus' })).rejects.toBeInstanceOf(
      IndicatorError,
    );
    expect((await profiles.get('p1'))?.indicators).toEqual([]);
  });

  it('throws IndicatorError on invalid inputs and persists nothing', async () => {
    const { service, profiles } = build();
    await service.create({ name: 'Scalper' });
    await expect(
      service.addIndicator('p1', { indicatorKey: 'sma', inputs: { length: 0 } }),
    ).rejects.toBeInstanceOf(IndicatorError);
    expect((await profiles.get('p1'))?.indicators).toEqual([]);
  });

  it('throws ProfileNotFoundError when the profile is unknown', async () => {
    const { service } = build();
    await expect(
      service.addIndicator('unknown-profile', { indicatorKey: 'sma' }),
    ).rejects.toBeInstanceOf(ProfileNotFoundError);
  });
});

describe('ProfileService.getIndicator / listIndicators', () => {
  it('returns the matching instance; an unknown instanceId throws IndicatorInstanceNotFoundError', async () => {
    const { service } = build();
    await service.create({ name: 'Scalper' });
    const instance = await service.addIndicator('p1', { indicatorKey: 'sma' });
    expect(await service.getIndicator('p1', instance.id)).toEqual(instance);
    await expect(service.getIndicator('p1', 'unknown')).rejects.toBeInstanceOf(
      IndicatorInstanceNotFoundError,
    );
  });
});

describe('ProfileService.replaceIndicator', () => {
  it('overwrites the matching instance with new inputs, preserving id and array length', async () => {
    const { service } = build();
    await service.create({ name: 'Scalper' });
    const first = await service.addIndicator('p1', { indicatorKey: 'sma' });
    const replaced = await service.replaceIndicator('p1', first.id, {
      indicatorKey: 'sma',
      inputs: { length: 21 },
    });
    expect(replaced).toEqual({
      id: first.id,
      indicatorKey: 'sma',
      version: 1,
      inputs: { length: 21, source: 'close' },
      summary: 'SMA 21 close',
    });
    expect(await service.listIndicators('p1')).toEqual([replaced]);
  });

  it('throws IndicatorInstanceNotFoundError when the instance is unknown', async () => {
    const { service } = build();
    await service.create({ name: 'Scalper' });
    await expect(
      service.replaceIndicator('p1', 'unknown', { indicatorKey: 'sma' }),
    ).rejects.toBeInstanceOf(IndicatorInstanceNotFoundError);
  });
});

describe('ProfileService.removeIndicator', () => {
  it('removes the matching instance', async () => {
    const { service } = build();
    await service.create({ name: 'Scalper' });
    const instance = await service.addIndicator('p1', { indicatorKey: 'sma' });
    await service.removeIndicator('p1', instance.id);
    expect(await service.listIndicators('p1')).toEqual([]);
  });

  it('throws IndicatorInstanceNotFoundError when the instance is unknown', async () => {
    const { service } = build();
    await service.create({ name: 'Scalper' });
    await expect(service.removeIndicator('p1', 'unknown')).rejects.toBeInstanceOf(
      IndicatorInstanceNotFoundError,
    );
  });
});
