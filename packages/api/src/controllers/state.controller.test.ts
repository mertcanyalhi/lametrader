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
 * Build an app whose `/state/global` route is driven by an
 * `InMemoryStateRepository` pre-seeded with the given entries.
 */
function buildApp(seed: Array<[string, StateValue]> = []) {
  const state = new InMemoryStateRepository();
  for (const [key, value] of seed) {
    void state.setGlobalState(key, value, 100);
  }
  const config = new ConfigService(new InMemoryConfigRepository());
  return createApp(buildAppDeps({ config, state }));
}

describe('GET /state/global', () => {
  it('returns the global state map (200)', async () => {
    const app = buildApp([
      ['regime', { type: StateValueType.Enum, value: 'risk-on' }],
      ['lastSweep', { type: StateValueType.Number, value: 42 }],
    ]);
    const res = await app.inject({ method: 'GET', url: '/state/global' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      regime: { type: 'enum', value: 'risk-on' },
      lastSweep: { type: 'number', value: 42 },
    });
  });

  it('returns {} when no global keys have been set', async () => {
    const res = await buildApp().inject({ method: 'GET', url: '/state/global' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({});
  });
});
