import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { buildAppDeps } from '../testing/app-deps.js';

describe('GET /notification/telegram/destinations', () => {
  it('returns the configured destination names as `{ name }` entries', async () => {
    const app = createApp(buildAppDeps({ telegramDestinationNames: ['main', 'alerts'] }));
    const res = await app.inject({ method: 'GET', url: '/notification/telegram/destinations' });
    expect({ status: res.statusCode, body: res.json() }).toEqual({
      status: 200,
      body: [{ name: 'main' }, { name: 'alerts' }],
    });
  });

  it('responds with 404 when no destination names are wired', async () => {
    const app = createApp(buildAppDeps());
    const res = await app.inject({ method: 'GET', url: '/notification/telegram/destinations' });
    expect(res.statusCode).toBe(404);
  });
});
