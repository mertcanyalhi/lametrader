import {
  InMemoryProfileRepository,
  InMemoryWatchlistRepository,
  ProfileService,
} from '@lametrader/engine';
import { describe, expect, it } from 'vitest';
import { runProfiles } from './profile.js';

/** A profiles service over in-memory repos with a deterministic id + clock. */
function build(): ProfileService {
  let n = 0;
  return new ProfileService(new InMemoryProfileRepository(), new InMemoryWatchlistRepository(), {
    newId: () => `p${++n}`,
    now: () => 1000,
  });
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
