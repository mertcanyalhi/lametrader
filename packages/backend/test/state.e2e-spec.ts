import { type StateRepository, StateValueType } from '@lametrader/core';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { STATE_REPOSITORY } from '../src/analytics/interfaces/state-repository.token.js';
import { AppModule } from '../src/app.module.js';

/**
 * E2E for the read-side global-state route from the API consumer's perspective:
 * the real Nest app over a real Mongo (Testcontainers). Writes go through the
 * Mongoose-backed {@link StateRepository}; reads come back through
 * `GET /profiles/:profileId/state/global`. State is partitioned by profile
 * (#281), so reads scope to the profile in the route. Mirrors the old Fastify
 * `state.e2e.test.ts`.
 */
describe('state API (e2e)', () => {
  let app: INestApplication;
  let state: StateRepository;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    state = app.get<StateRepository>(STATE_REPOSITORY);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('GET /profiles/:profileId/state/global returns {} when no keys have been set', async () => {
    const res = await request(app.getHttpServer()).get('/profiles/profile-1/state/global');
    expect({ status: res.status, body: res.body }).toEqual({ status: 200, body: {} });
  });

  it('GET /profiles/:profileId/state/global returns every set global key after writes', async () => {
    await state.setGlobalState(
      'profile-2',
      'regime',
      { type: StateValueType.String, value: 'risk-on' },
      100,
    );
    await state.setGlobalState(
      'profile-2',
      'lastSweep',
      { type: StateValueType.Number, value: 42 },
      101,
    );
    const res = await request(app.getHttpServer()).get('/profiles/profile-2/state/global');
    expect({ status: res.status, body: res.body }).toEqual({
      status: 200,
      body: {
        regime: { type: 'string', value: 'risk-on' },
        lastSweep: { type: 'number', value: 42 },
      },
    });
  });

  it('GET /profiles/:profileId/state/global returns {} for a different profileId', async () => {
    await state.setGlobalState(
      'profile-3',
      'regime',
      { type: StateValueType.String, value: 'risk-on' },
      100,
    );
    const res = await request(app.getHttpServer()).get('/profiles/profile-99/state/global');
    expect({ status: res.status, body: res.body }).toEqual({ status: 200, body: {} });
  });
});
