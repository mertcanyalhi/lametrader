import { createApp } from '@lametrader/api';
import { connectServices, loadSettings } from '@lametrader/engine';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Default poll cadence; this suite never starts polling, so any value works. */
const { pollIntervals } = loadSettings({});

/**
 * E2E for the config-notifications sub-resource from the API consumer's
 * perspective: a real Fastify app over a real Mongo (Testcontainers),
 * exercised over HTTP under `/config/notifications/telegram`.
 *
 * Storage is folded into the shared config K/V store (one fewer collection +
 * port + adapter), so this round-trip also verifies the new
 * `ConfigKey.TelegramDestinations` key persists correctly across processes.
 */
describe('config notifications API (e2e)', () => {
  let container: StartedMongoDBContainer;
  let uri: string;
  let close: () => Promise<void>;
  let app: FastifyInstance;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8').start();
    uri = `${container.getConnectionString()}?directConnection=true`;
    const wired = await connectServices(uri, { pollIntervals });
    close = wired.close;
    app = createApp({
      config: wired.config,
      symbols: wired.symbols,
      telegramDestinations: wired.telegramDestinations,
      backfill: wired.backfill,
      indicators: { registry: wired.indicators, compute: wired.indicatorCompute },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await close?.();
    await container?.stop();
  });

  it('round-trips an upsert across a fresh connection (persists in the K/V store)', async () => {
    const post = await app.inject({
      method: 'POST',
      url: '/config/notifications/telegram',
      payload: { name: 'main', botToken: 'TOKEN-1', chatId: '123' },
    });
    expect({ status: post.statusCode, body: post.json() }).toEqual({
      status: 200,
      body: { name: 'main', chatId: '123' },
    });

    const second = await connectServices(uri, { pollIntervals });
    const fresh = createApp({
      config: second.config,
      symbols: second.symbols,
      telegramDestinations: second.telegramDestinations,
      backfill: second.backfill,
      indicators: { registry: second.indicators, compute: second.indicatorCompute },
    });
    await fresh.ready();
    const get = await fresh.inject({ method: 'GET', url: '/config/notifications/telegram' });
    expect({ status: get.statusCode, body: get.json() }).toEqual({
      status: 200,
      body: [{ name: 'main', chatId: '123' }],
    });
    await fresh.close();
    await second.close();
  });

  it('DELETE removes the destination and a second DELETE returns 404', async () => {
    await app.inject({
      method: 'POST',
      url: '/config/notifications/telegram',
      payload: { name: 'doomed', botToken: 'TOKEN-X', chatId: '999' },
    });

    const first = await app.inject({
      method: 'DELETE',
      url: '/config/notifications/telegram/doomed',
    });
    const second = await app.inject({
      method: 'DELETE',
      url: '/config/notifications/telegram/doomed',
    });

    expect({ first: first.statusCode, second: second.statusCode }).toEqual({
      first: 204,
      second: 404,
    });
  });
});
