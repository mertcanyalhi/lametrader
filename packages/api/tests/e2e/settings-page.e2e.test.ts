import { createApp } from '@lametrader/api';
import { connectServices, loadSettings } from '@lametrader/engine';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Default poll cadence; this suite never starts polling, so any value works. */
const { pollIntervals } = loadSettings({});

/**
 * E2E for the settings page's HTTP contract — the same Fastify app the
 * browser hits, exercised against real Mongo (Testcontainers). Pins the
 * happy path and the critical failure mode the page binds to in
 * `specs/web-settings-page.spec.md`.
 *
 * Goes beyond `config.e2e.test.ts` only by tracing the round-trip the page
 * actually issues — `GET → PUT → GET (returns the saved value)` and
 * `PUT (rejected) → GET (still returns the previous value)`.
 */
describe('settings page HTTP contract (e2e)', () => {
  let container: StartedMongoDBContainer;
  let close: () => Promise<void>;
  let app: FastifyInstance;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8').start();
    const uri = `${container.getConnectionString()}?directConnection=true`;
    const wired = await connectServices(uri, { pollIntervals });
    close = wired.close;
    app = createApp({
      config: wired.config,
      symbols: wired.symbols,
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

  it('GET → PUT → GET returns the saved config (the page round-trip)', async () => {
    const initialGet = await app.inject({ method: 'GET', url: '/config' });
    const put = await app.inject({
      method: 'PUT',
      url: '/config',
      payload: { periods: ['1m', '5m', '1h', '1d'], defaultPeriod: '1h' },
    });
    const finalGet = await app.inject({ method: 'GET', url: '/config' });

    expect({
      initialStatus: initialGet.statusCode,
      initialBody: initialGet.json(),
      putStatus: put.statusCode,
      putBody: put.json(),
      finalBody: finalGet.json(),
    }).toEqual({
      initialStatus: 200,
      initialBody: { periods: ['1h', '1d'], defaultPeriod: '1d' },
      putStatus: 200,
      putBody: { periods: ['1m', '5m', '1h', '1d'], defaultPeriod: '1h' },
      finalBody: { periods: ['1m', '5m', '1h', '1d'], defaultPeriod: '1h' },
    });
  });

  it('rejected PUT (empty periods) returns 400 and leaves the stored config unchanged', async () => {
    const before = await app.inject({ method: 'GET', url: '/config' });
    const rejected = await app.inject({
      method: 'PUT',
      url: '/config',
      payload: { periods: [], defaultPeriod: '1d' },
    });
    const after = await app.inject({ method: 'GET', url: '/config' });

    expect({
      rejectedStatus: rejected.statusCode,
      rejectedBody: rejected.json(),
      beforeBody: before.json(),
      afterBody: after.json(),
    }).toEqual({
      rejectedStatus: 400,
      rejectedBody: { error: 'periods must not be empty' },
      beforeBody: { periods: ['1m', '5m', '1h', '1d'], defaultPeriod: '1h' },
      afterBody: { periods: ['1m', '5m', '1h', '1d'], defaultPeriod: '1h' },
    });
  });
});
