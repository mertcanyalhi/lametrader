import {
  InMemoryTelegramDestinationsRepository,
  TelegramDestinationsService,
} from '@lametrader/engine';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { buildAppDeps } from '../testing/app-deps.js';

/** Build an app with a TelegramDestinationsService seeded with the given destinations. */
async function buildApp(seed: Array<{ name: string; botToken: string; chatId: string }> = []) {
  const repo = new InMemoryTelegramDestinationsRepository();
  for (const destination of seed) await repo.upsert(destination);
  const telegramDestinations = new TelegramDestinationsService(repo);
  return createApp(buildAppDeps({ telegramDestinations }));
}

describe('GET /notification/telegram/destinations', () => {
  it('returns the configured destinations as `{ name, chatId }` (no bot tokens)', async () => {
    const app = await buildApp([
      { name: 'main', botToken: 'TOKEN-1', chatId: '123' },
      { name: 'alerts', botToken: 'TOKEN-2', chatId: '456' },
    ]);
    const res = await app.inject({ method: 'GET', url: '/notification/telegram/destinations' });
    expect({ status: res.statusCode, body: res.json() }).toEqual({
      status: 200,
      body: [
        { name: 'main', chatId: '123' },
        { name: 'alerts', chatId: '456' },
      ],
    });
  });

  it('responds with 404 when no destinations service is wired', async () => {
    const app = createApp(buildAppDeps());
    const res = await app.inject({ method: 'GET', url: '/notification/telegram/destinations' });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /notification/telegram/destinations', () => {
  it('upserts a new destination and returns its summary (200)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/notification/telegram/destinations',
      payload: { name: 'main', botToken: 'TOKEN-1', chatId: '123' },
    });
    expect({ status: res.statusCode, body: res.json() }).toEqual({
      status: 200,
      body: { name: 'main', chatId: '123' },
    });
  });

  it('replaces an existing destination keyed by name', async () => {
    const app = await buildApp([{ name: 'main', botToken: 'TOKEN-1', chatId: '123' }]);
    const res = await app.inject({
      method: 'POST',
      url: '/notification/telegram/destinations',
      payload: { name: 'main', botToken: 'TOKEN-2', chatId: '456' },
    });
    const listed = await app.inject({
      method: 'GET',
      url: '/notification/telegram/destinations',
    });
    expect({ status: res.statusCode, listed: listed.json() }).toEqual({
      status: 200,
      listed: [{ name: 'main', chatId: '456' }],
    });
  });

  it('rejects an empty botToken with 400', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/notification/telegram/destinations',
      payload: { name: 'main', botToken: '', chatId: '123' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('DELETE /notification/telegram/destinations/:name', () => {
  it('removes the named destination and responds with 204', async () => {
    const app = await buildApp([{ name: 'main', botToken: 'TOKEN-1', chatId: '123' }]);
    const res = await app.inject({
      method: 'DELETE',
      url: '/notification/telegram/destinations/main',
    });
    const listed = await app.inject({
      method: 'GET',
      url: '/notification/telegram/destinations',
    });
    expect({ status: res.statusCode, listed: listed.json() }).toEqual({
      status: 204,
      listed: [],
    });
  });

  it('responds with 404 when no destination with that name exists', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/notification/telegram/destinations/ghost',
    });
    expect(res.statusCode).toBe(404);
  });
});
