import {
  InMemoryProfileRepository,
  InMemoryWatchlistRepository,
  ProfileService,
} from '@lametrader/engine';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { buildAppDeps } from '../testing/app-deps';

/**
 * Build an app whose profiles use-case has a deterministic id generator and clock,
 * so route responses are assertable in full.
 */
function buildApp() {
  let n = 0;
  const profiles = new ProfileService(
    new InMemoryProfileRepository(),
    new InMemoryWatchlistRepository(),
    { newId: () => `p${++n}`, now: () => 1000 },
  );
  return createApp(buildAppDeps({ profiles }));
}

describe('POST /profiles', () => {
  it('creates a profile with defaults (201)', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/profiles',
      payload: { name: 'Scalper' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      id: 'p1',
      name: 'Scalper',
      description: '',
      enabled: true,
      scope: { type: 'all' },
      createdAt: 1000,
      updatedAt: 1000,
    });
  });

  it('rejects a duplicate name with 409', async () => {
    const app = buildApp();
    await app.inject({ method: 'POST', url: '/profiles', payload: { name: 'Scalper' } });
    const res = await app.inject({
      method: 'POST',
      url: '/profiles',
      payload: { name: 'Scalper' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects a blank name with 400', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'POST', url: '/profiles', payload: { name: '  ' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /profiles and /profiles/:id', () => {
  it('lists profiles and gets one; an unknown id is 404', async () => {
    const app = buildApp();
    await app.inject({ method: 'POST', url: '/profiles', payload: { name: 'Scalper' } });

    expect((await app.inject({ method: 'GET', url: '/profiles' })).json()).toEqual([
      {
        id: 'p1',
        name: 'Scalper',
        description: '',
        enabled: true,
        scope: { type: 'all' },
        createdAt: 1000,
        updatedAt: 1000,
      },
    ]);

    expect((await app.inject({ method: 'GET', url: '/profiles/p1' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/profiles/nope' })).statusCode).toBe(404);
  });
});

describe('PATCH /profiles/:id', () => {
  it('updates a single field (200)', async () => {
    const app = buildApp();
    await app.inject({ method: 'POST', url: '/profiles', payload: { name: 'Scalper' } });
    const res = await app.inject({
      method: 'PATCH',
      url: '/profiles/p1',
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: 'p1',
      name: 'Scalper',
      description: '',
      enabled: false,
      scope: { type: 'all' },
      createdAt: 1000,
      updatedAt: 1000,
    });
  });
});

describe('DELETE /profiles/:id', () => {
  it('deletes (204) then 404 on the second delete', async () => {
    const app = buildApp();
    await app.inject({ method: 'POST', url: '/profiles', payload: { name: 'Scalper' } });
    expect((await app.inject({ method: 'DELETE', url: '/profiles/p1' })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: '/profiles/p1' })).statusCode).toBe(404);
  });
});
