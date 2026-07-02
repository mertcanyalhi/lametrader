import { type StateValue, StateValueType } from '@lametrader/core';
import {
  ConfigService,
  InMemoryConfigRepository,
  InMemoryStateRepository,
} from '@lametrader/engine';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { buildAppDeps } from '../testing/app-deps';

/**
 * Build an app whose `/profiles/:profileId/state/global` route is driven by
 * an `InMemoryStateRepository` pre-seeded with the given entries under
 * `profile-1`.
 */
function buildApp(seed: Array<[string, StateValue]> = []) {
  const state = new InMemoryStateRepository();
  for (const [key, value] of seed) {
    void state.setGlobalState('profile-1', key, value, 100);
  }
  const config = new ConfigService(new InMemoryConfigRepository());
  return createApp(buildAppDeps({ config, state }));
}

describe('GET /profiles/:profileId/state/global', () => {
  it("returns the profile's global state map (200)", async () => {
    const app = buildApp([
      ['regime', { type: StateValueType.String, value: 'risk-on' }],
      ['lastSweep', { type: StateValueType.Number, value: 42 }],
    ]);
    const res = await app.inject({ method: 'GET', url: '/profiles/profile-1/state/global' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      regime: { type: 'string', value: 'risk-on' },
      lastSweep: { type: 'number', value: 42 },
    });
  });

  it('returns {} when no global keys have been set for the profile', async () => {
    const res = await buildApp().inject({
      method: 'GET',
      url: '/profiles/profile-1/state/global',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({});
  });

  it('returns {} for a different profileId that has no keys', async () => {
    const app = buildApp([['regime', { type: StateValueType.String, value: 'risk-on' }]]);
    const res = await app.inject({
      method: 'GET',
      url: '/profiles/profile-2/state/global',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({});
  });
});
