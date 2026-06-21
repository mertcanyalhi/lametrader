import { ConfigService, InMemoryConfigRepository } from '@lametrader/engine';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { buildAppDeps } from '../testing/app-deps';

/**
 * Builds an app backed by a real `ConfigService` over an in-memory repository,
 * so the config routes are exercised through the use-case (and the app's shared
 * error handler) without I/O.
 */
function buildApp() {
  return createApp(buildAppDeps({ config: new ConfigService(new InMemoryConfigRepository()) }));
}

describe('GET /config', () => {
  it('returns 200 with the current config', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/config' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ periods: ['1h', '1d'], defaultPeriod: '1d' });
  });
});

describe('PUT /config', () => {
  it('returns 200 with the stored config on a valid body', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/config',
      payload: { periods: ['1h', '4h', '1d'], defaultPeriod: '4h' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ periods: ['1h', '4h', '1d'], defaultPeriod: '4h' });
  });

  it('returns 400 on an invalid body', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/config',
      payload: { periods: [], defaultPeriod: '1d' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'periods must not be empty' });
  });
});

describe('PATCH /config', () => {
  it('returns 200 with the merged config on a partial body', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/config',
      payload: { defaultPeriod: '1h' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ periods: ['1h', '1d'], defaultPeriod: '1h' });
  });

  it('returns 400 when the merge is invalid', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/config',
      payload: { periods: ['1h', '4h'] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'defaultPeriod 1d is not in periods' });
  });
});
