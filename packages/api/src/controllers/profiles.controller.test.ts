import { Period, SymbolType, type WatchedSymbol } from '@lametrader/core';
import {
  defaultIndicators,
  InMemoryProfileRepository,
  InMemoryWatchlistRepository,
  ProfileService,
} from '@lametrader/engine';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { buildAppDeps } from '../testing/app-deps';

/** A watched crypto symbol for scope-validation tests. */
const WATCHED_BTC: WatchedSymbol = {
  id: 'crypto:BTCUSDT',
  type: SymbolType.Crypto,
  description: 'Bitcoin / TetherUS',
  exchange: 'Binance',
  currency: 'USDT',
  periods: [Period.OneHour],
};

/**
 * Build an app whose profiles use-case has a deterministic id generator and clock,
 * so route responses are assertable in full. The watchlist is seeded with
 * `WATCHED_BTC` so symbols-scoped requests can succeed.
 */
function buildApp() {
  let n = 0;
  const profiles = new ProfileService(
    new InMemoryProfileRepository(),
    new InMemoryWatchlistRepository([WATCHED_BTC]),
    defaultIndicators(),
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
      indicators: [],
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
        indicators: [],
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
      indicators: [],
    });
  });
});

describe('PUT /profiles/:id', () => {
  it('replaces the profile, including a symbols-scope referencing a watched id (200)', async () => {
    const app = buildApp();
    await app.inject({ method: 'POST', url: '/profiles', payload: { name: 'Scalper' } });
    const res = await app.inject({
      method: 'PUT',
      url: '/profiles/p1',
      payload: {
        name: 'Scalper',
        scope: { type: 'symbols', symbolIds: ['crypto:BTCUSDT'] },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: 'p1',
      name: 'Scalper',
      description: '',
      enabled: true,
      scope: { type: 'symbols', symbolIds: ['crypto:BTCUSDT'] },
      createdAt: 1000,
      updatedAt: 1000,
      indicators: [],
    });
  });
});

describe('profile indicator sub-resource', () => {
  it('attach (POST) returns 201 with the instance', async () => {
    const app = buildApp();
    await app.inject({ method: 'POST', url: '/profiles', payload: { name: 'Scalper' } });
    const res = await app.inject({
      method: 'POST',
      url: '/profiles/p1/indicators',
      payload: { indicatorKey: 'sma' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      id: 'p2',
      indicatorKey: 'sma',
      version: 1,
      inputs: { length: 14, source: 'close' },
      summary: 'SMA 14 close',
    });
  });

  it('list (GET) returns the attached instances', async () => {
    const app = buildApp();
    await app.inject({ method: 'POST', url: '/profiles', payload: { name: 'Scalper' } });
    await app.inject({
      method: 'POST',
      url: '/profiles/p1/indicators',
      payload: { indicatorKey: 'sma', inputs: { length: 5 } },
    });
    const res = await app.inject({ method: 'GET', url: '/profiles/p1/indicators' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        id: 'p2',
        indicatorKey: 'sma',
        version: 1,
        inputs: { length: 5, source: 'close' },
        summary: 'SMA 5 close',
      },
    ]);
  });

  it('attach (POST) returns 400 on an unknown indicatorKey', async () => {
    const app = buildApp();
    await app.inject({ method: 'POST', url: '/profiles', payload: { name: 'Scalper' } });
    const res = await app.inject({
      method: 'POST',
      url: '/profiles/p1/indicators',
      payload: { indicatorKey: 'bogus' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('replace (PUT) overwrites the instance', async () => {
    const app = buildApp();
    await app.inject({ method: 'POST', url: '/profiles', payload: { name: 'Scalper' } });
    await app.inject({
      method: 'POST',
      url: '/profiles/p1/indicators',
      payload: { indicatorKey: 'sma' },
    });
    const res = await app.inject({
      method: 'PUT',
      url: '/profiles/p1/indicators/p2',
      payload: { indicatorKey: 'sma', inputs: { length: 21 } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: 'p2',
      indicatorKey: 'sma',
      version: 1,
      inputs: { length: 21, source: 'close' },
      summary: 'SMA 21 close',
    });
  });

  it('detach (DELETE) 204 then 404 on second delete', async () => {
    const app = buildApp();
    await app.inject({ method: 'POST', url: '/profiles', payload: { name: 'Scalper' } });
    await app.inject({
      method: 'POST',
      url: '/profiles/p1/indicators',
      payload: { indicatorKey: 'sma' },
    });
    expect(
      (await app.inject({ method: 'DELETE', url: '/profiles/p1/indicators/p2' })).statusCode,
    ).toBe(204);
    expect(
      (await app.inject({ method: 'DELETE', url: '/profiles/p1/indicators/p2' })).statusCode,
    ).toBe(404);
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
