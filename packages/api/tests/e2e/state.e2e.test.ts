import { createApp } from '@lametrader/api';
import { StateValueType } from '@lametrader/core';
import { connectServices, loadSettings } from '@lametrader/engine';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const { pollIntervals } = loadSettings({});

/**
 * E2E for the read-side rule-engine state routes from the API consumer's
 * perspective. Real Fastify over real Mongo (Testcontainers): writes go
 * through `MongoStateRepository`, reads come back through `/state/global`.
 * Mirrors the acceptance criteria in #145.
 */
describe('state API (e2e)', () => {
  let container: StartedMongoDBContainer;
  let close: () => Promise<void>;
  let app: FastifyInstance;
  let state: import('@lametrader/core').StateRepository;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8').start();
    const uri = `${container.getConnectionString()}?directConnection=true`;
    const wired = await connectServices(uri, { pollIntervals });
    close = wired.close;
    state = wired.state;
    app = createApp({
      config: wired.config,
      symbols: wired.symbols,
      state: wired.state,
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

  it('GET /state/global returns {} when no keys have been set', async () => {
    const res = await app.inject({ method: 'GET', url: '/state/global' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({});
  });

  it('GET /state/global returns every set global key after writes', async () => {
    await state.setGlobalState('regime', { type: StateValueType.Enum, value: 'risk-on' }, 100);
    await state.setGlobalState('lastSweep', { type: StateValueType.Number, value: 42 }, 101);
    const res = await app.inject({ method: 'GET', url: '/state/global' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      regime: { type: 'enum', value: 'risk-on' },
      lastSweep: { type: 'number', value: 42 },
    });
  });
});
