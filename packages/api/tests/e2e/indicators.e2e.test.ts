import { createApp } from '@lametrader/api';
import type { IndicatorDefinition } from '@lametrader/core';
import {
  ConfigService,
  defaultIndicators,
  movingAverage,
  volumeWeightedMovingAverage,
} from '@lametrader/engine';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { FastifyInstance } from 'fastify';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * E2E for the indicator catalog from the API consumer's perspective: a real
 * Fastify app — composed via createApp the same way main.ts does — exposes
 * `GET /indicators` and `GET /indicators/:key` over the `defaultIndicators()`
 * registry. The container/Mongo is spun up so the app composes with the same
 * shape as production (other controllers register too); this suite asserts only
 * the indicator routes.
 *
 * Closes the deferred end-to-end coverage from #12 and #13 on the
 * catalog/serialization surface: both reference indicators (`sma` from #12,
 * `vwma` from #13) are round-tripped over real HTTP with their full descriptor
 * shapes (inputs, state, appliesTo).
 */
describe('indicators API (e2e)', () => {
  let container: StartedMongoDBContainer;
  let client: MongoClient;
  let app: FastifyInstance;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8').start();
    client = new MongoClient(`${container.getConnectionString()}?directConnection=true`);
    await client.connect();
    const db = client.db('lametrader');

    // Minimal app: only the config + indicators surfaces are needed.
    const config = new ConfigService({
      load: async () => db.collection('config').findOne({ _id: 'singleton' as never }) as never,
      save: async () => {
        /* unused */
      },
    });
    app = createApp({ config, indicators: defaultIndicators() });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await client?.close();
    await container?.stop();
  });

  it('GET /indicators returns the full catalog with both reference indicators', async () => {
    const res = await app.inject({ method: 'GET', url: '/indicators' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as IndicatorDefinition[];
    const byKey = Object.fromEntries(body.map((d) => [d.key, d]));
    expect(byKey).toEqual({
      sma: movingAverage.definition,
      vwma: volumeWeightedMovingAverage.definition,
    });
  });

  it('GET /indicators/sma returns the moving-average definition', async () => {
    const res = await app.inject({ method: 'GET', url: '/indicators/sma' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(movingAverage.definition);
  });

  it('GET /indicators/vwma returns the VWMA definition (covers #13 enum/markers/separate surface)', async () => {
    const res = await app.inject({ method: 'GET', url: '/indicators/vwma' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(volumeWeightedMovingAverage.definition);
  });

  it('GET /indicators/unknown-key returns 404 with { error }', async () => {
    const res = await app.inject({ method: 'GET', url: '/indicators/unknown-key' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'indicator not found: unknown-key' });
  });
});
