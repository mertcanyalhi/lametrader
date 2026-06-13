import { createApp } from '@lametrader/api';
import { connectServices } from '@lametrader/engine';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * E2E for the config feature from the API consumer's perspective: a real Fastify
 * app over a real Mongo (Testcontainers), exercised over HTTP. Mirrors the
 * acceptance criteria in `specs/config-layer.spec.md`.
 */
describe('config API (e2e)', () => {
  let container: StartedMongoDBContainer;
  let uri: string;
  let close: () => Promise<void>;
  let app: FastifyInstance;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8').start();
    uri = `${container.getConnectionString()}?directConnection=true`;
    const wired = await connectServices(uri);
    close = wired.close;
    app = createApp({ config: wired.config, symbols: wired.symbols, backfill: wired.backfill });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await close?.();
    await container?.stop();
  });

  it('GET /config returns the default config when nothing is stored', async () => {
    const res = await app.inject({ method: 'GET', url: '/config' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ periods: ['1h', '1d'], defaultPeriod: '1d' });
  });

  it('PUT /config replaces and the value persists for a fresh connection', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/config',
      payload: { periods: ['1h', '4h', '1d'], defaultPeriod: '4h' },
    });
    expect(put.statusCode).toBe(200);

    const second = await connectServices(uri);
    const fresh = createApp({ config: second.config });
    const get = await fresh.inject({ method: 'GET', url: '/config' });
    expect(get.json()).toEqual({ periods: ['1h', '4h', '1d'], defaultPeriod: '4h' });
    await fresh.close();
    await second.close();
  });

  it('PATCH /config merges over the current config', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/config',
      payload: { defaultPeriod: '1d' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ periods: ['1h', '4h', '1d'], defaultPeriod: '1d' });
  });

  it('PUT /config rejects an invalid body with 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/config',
      payload: { periods: [], defaultPeriod: '1d' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'periods must not be empty' });
  });
});
