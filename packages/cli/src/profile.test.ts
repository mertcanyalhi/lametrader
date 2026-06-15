import {
  defaultIndicators,
  InMemoryProfileRepository,
  InMemoryWatchlistRepository,
  ProfileService,
} from '@lametrader/engine';
import { describe, expect, it } from 'vitest';
import { runProfiles } from './profile.js';

/** A profiles service over in-memory repos with a deterministic id + clock. */
function build(): ProfileService {
  let n = 0;
  return new ProfileService(
    new InMemoryProfileRepository(),
    new InMemoryWatchlistRepository(),
    defaultIndicators(),
    { newId: () => `p${++n}`, now: () => 1000 },
  );
}

describe('runProfiles', () => {
  it('creates a profile and lists it', async () => {
    const service = build();
    const created = JSON.parse(await runProfiles(['create', '--name', 'Scalper'], service));
    expect(created).toEqual({
      id: 'p1',
      name: 'Scalper',
      description: '',
      enabled: true,
      scope: { type: 'all' },
      createdAt: 1000,
      updatedAt: 1000,
      indicators: [],
    });
    expect(JSON.parse(await runProfiles(['list'], service))).toEqual([created]);
  });

  it('updates a profile (disable)', async () => {
    const service = build();
    await runProfiles(['create', '--name', 'Scalper'], service);
    const updated = JSON.parse(await runProfiles(['update', 'p1', '--disable'], service));
    expect(updated).toEqual({
      id: 'p1',
      name: 'Scalper',
      description: '',
      enabled: false,
      scope: { type: 'all' },
      createdAt: 1000,
      updatedAt: 1000,
      indicators: [],
    });
  });

  it('deletes a profile', async () => {
    const service = build();
    await runProfiles(['create', '--name', 'Scalper'], service);
    expect(await runProfiles(['delete', 'p1'], service)).toBe('deleted p1');
    expect(JSON.parse(await runProfiles(['list'], service))).toEqual([]);
  });

  it('throws on an unknown subcommand', async () => {
    await expect(runProfiles(['bogus'], build())).rejects.toThrow();
  });
});

describe('runProfiles indicators sub-group', () => {
  it('add attaches an indicator and prints the instance', async () => {
    const service = build();
    await runProfiles(['create', '--name', 'Scalper'], service);
    const instance = JSON.parse(
      await runProfiles(
        [
          'indicators',
          'add',
          'p1',
          '--indicator-key',
          'sma',
          '--inputs',
          '{"length":5}',
          '--label',
          'Fast',
        ],
        service,
      ),
    );
    expect(instance).toEqual({
      id: 'p2',
      indicatorKey: 'sma',
      version: 1,
      inputs: { length: 5, source: 'close' },
      label: 'Fast',
    });
  });

  it('list prints the embedded instances', async () => {
    const service = build();
    await runProfiles(['create', '--name', 'Scalper'], service);
    await runProfiles(['indicators', 'add', 'p1', '--indicator-key', 'sma'], service);
    expect(JSON.parse(await runProfiles(['indicators', 'list', 'p1'], service))).toEqual([
      { id: 'p2', indicatorKey: 'sma', version: 1, inputs: { length: 14, source: 'close' } },
    ]);
  });

  it('update replaces an instance', async () => {
    const service = build();
    await runProfiles(['create', '--name', 'Scalper'], service);
    await runProfiles(['indicators', 'add', 'p1', '--indicator-key', 'sma'], service);
    const updated = JSON.parse(
      await runProfiles(
        ['indicators', 'update', 'p1', 'p2', '--indicator-key', 'sma', '--inputs', '{"length":21}'],
        service,
      ),
    );
    expect(updated).toEqual({
      id: 'p2',
      indicatorKey: 'sma',
      version: 1,
      inputs: { length: 21, source: 'close' },
    });
  });

  it('remove detaches an instance', async () => {
    const service = build();
    await runProfiles(['create', '--name', 'Scalper'], service);
    await runProfiles(['indicators', 'add', 'p1', '--indicator-key', 'sma'], service);
    expect(await runProfiles(['indicators', 'remove', 'p1', 'p2'], service)).toBe('removed p2');
  });

  it('throws on an unknown indicators subcommand', async () => {
    await expect(runProfiles(['indicators', 'bogus'], build())).rejects.toThrow();
  });
});
