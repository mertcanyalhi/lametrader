import {
  type Candle,
  Period,
  type Profile,
  ProfileScope,
  StateValueType,
  SymbolType,
  type WatchedSymbol,
} from '@lametrader/core';
import { IndicatorError, IndicatorInstanceNotFoundError } from '../../common/domain/indicator.js';
import {
  ProfileConflictError,
  ProfileError,
  ProfileNotFoundError,
} from '../../common/domain/profile.js';
import { InMemoryCandleRepository } from '../../market/persistence/in-memory-candle.repository.js';
import { InMemoryWatchlistRepository } from '../../market/persistence/in-memory-watchlist.repository.js';
import { defaultIndicators } from '../indicators/default-indicators.js';
import { IndicatorService } from '../indicators/indicator.service.js';
import type { IndicatorRegistry } from '../indicators/indicator-registry.js';
import type {
  ProfileCascadeIndicatorStore,
  ProfileCascadeRules,
} from '../interfaces/profile.service.types.js';
import { InMemoryProfileRepository } from '../persistence/in-memory-profile.repository.js';
import {
  type IndicatorInstanceConfig,
  IndicatorSeriesStore,
} from '../rules/indicator-series-store.js';
import { ProfileService } from './profile.service.js';

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

/** Symbol the shared-store cascade tests seed candles + compute the SMA for. */
const STORE_SYMBOL = 'crypto:BTCUSDT';
/** Period the shared-store cascade tests watch + compute on. */
const STORE_PERIOD = Period.OneMinute;
/** Upper bound that admits every seeded bar. */
const NO_UPPER_BOUND = Number.MAX_SAFE_INTEGER;

/** One-minute crypto candle with uniform OHLC around `close`. */
const storeCandle = (time: number, close: number): Candle => ({
  type: SymbolType.Crypto,
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
  quoteVolume: close,
  trades: 1,
});

/**
 * Build a {@link ProfileService} sharing one real {@link IndicatorSeriesStore} —
 * exactly how production wires them — over a candle repo seeded with `closes`, so
 * an attached SMA instance's series resolves through the same store instance.
 *
 * No boot-time registration is run: only the profile mutations feed the store,
 * which is the #519 path under test.
 */
async function buildWithStore(
  closes: number[],
): Promise<{ service: ProfileService; store: IndicatorSeriesStore }> {
  const registry = defaultIndicators();
  const candles = new InMemoryCandleRepository();
  await candles.save(
    STORE_SYMBOL,
    STORE_PERIOD,
    closes.map((close, i) => storeCandle((i + 1) * 60_000, close)),
  );
  const watchlist = new InMemoryWatchlistRepository([
    {
      id: STORE_SYMBOL,
      type: SymbolType.Crypto,
      description: 'BTC',
      exchange: 'Binance',
      periods: [STORE_PERIOD],
    },
  ]);
  const store = new IndicatorSeriesStore(
    candles,
    new IndicatorService(registry, watchlist, candles),
  );
  const service = new ProfileService(new InMemoryProfileRepository(), watchlist, registry, {
    newId: sequentialIds(),
    now: () => 1000,
    indicatorStore: store,
  });
  return { service, store };
}

/**
 * A {@link ProfileCascadeIndicatorStore} fake recording every register /
 * unregister call — the store-cascade parallel of {@link RecordingCascadeRules}.
 *
 * Used where the observable outcome (an empty series) can't distinguish an
 * unregister from the never-registered baseline, so the call itself is asserted.
 */
class RecordingIndicatorStore implements ProfileCascadeIndicatorStore {
  /** Configs registered, in call order. */
  readonly registered: IndicatorInstanceConfig[] = [];
  /** Instance ids unregistered, in call order. */
  readonly unregistered: string[] = [];

  register(config: IndicatorInstanceConfig): void {
    this.registered.push(config);
  }

  unregister(instanceId: string): void {
    this.unregistered.push(instanceId);
  }
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

describe('ProfileService indicator-store cascade', () => {
  it('registers an added instance so the shared store resolves a non-empty series without boot-time registration', async () => {
    const { service, store } = await buildWithStore([10, 20, 30]);
    await service.create({ name: 'Scalper' });
    const instance = await service.addIndicator('p1', {
      indicatorKey: 'sma',
      inputs: { length: 3 },
    });

    // SMA(3) over [10,20,30] = 20 at the newest bar; before #519's fix the store
    // never learned of the attach, so this resolved EMPTY_SERIES → null.
    expect(
      await store
        .series(STORE_SYMBOL, STORE_PERIOD, instance.id, 'value', NO_UPPER_BOUND)
        .asOf(NO_UPPER_BOUND),
    ).toEqual({ ts: 180_000, value: { type: StateValueType.Number, value: 20 } });
  });

  it('re-registers a replaced instance so the shared store reflects the replacement inputs', async () => {
    const { service, store } = await buildWithStore([10, 20, 30, 40, 50]);
    await service.create({ name: 'Scalper' });
    const added = await service.addIndicator('p1', { indicatorKey: 'sma', inputs: { length: 3 } });
    await service.replaceIndicator('p1', added.id, { indicatorKey: 'sma', inputs: { length: 5 } });

    // SMA(5) over [10..50] = 30 at the newest bar — the replacement overwrote the
    // prior SMA(3) config, which would instead resolve 40.
    expect(
      await store
        .series(STORE_SYMBOL, STORE_PERIOD, added.id, 'value', NO_UPPER_BOUND)
        .asOf(NO_UPPER_BOUND),
    ).toEqual({ ts: 300_000, value: { type: StateValueType.Number, value: 30 } });
  });

  it('unregisters a removed instance from the shared store', async () => {
    const store = new RecordingIndicatorStore();
    const service = new ProfileService(
      new InMemoryProfileRepository(),
      new InMemoryWatchlistRepository(),
      defaultIndicators(),
      { newId: sequentialIds(), now: () => 1000, indicatorStore: store },
    );
    await service.create({ name: 'Scalper' });
    const added = await service.addIndicator('p1', { indicatorKey: 'sma' });

    await service.removeIndicator('p1', added.id);

    // The empty series after a remove can't be told apart from never-registered,
    // so assert the cascade calls: add registered the config, remove dropped it.
    expect({ registered: store.registered, unregistered: store.unregistered }).toEqual({
      registered: [
        { instanceId: added.id, indicatorKey: 'sma', inputs: { length: 14, source: 'close' } },
      ],
      unregistered: [added.id],
    });
  });
});
