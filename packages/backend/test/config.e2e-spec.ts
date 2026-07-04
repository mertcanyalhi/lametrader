import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

/**
 * E2E for the config feature from the API consumer's perspective: the real Nest
 * app over a real Mongo (Testcontainers), exercised over HTTP. Mirrors the old
 * Fastify `config.e2e.test.ts` byte-for-byte on routes, status codes, and
 * payloads.
 */
describe('config API (e2e)', () => {
  let container: StartedMongoDBContainer;
  let app: INestApplication;

  /** Boot a fresh Nest app against the shared container (a "new connection"). */
  async function bootApp(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const nestApp = moduleRef.createNestApplication();
    await nestApp.init();
    return nestApp;
  }

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8').start();
    process.env.MONGODB_URI = `${container.getConnectionString()}/?directConnection=true`;
    app = await bootApp();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await container?.stop();
  });

  it('GET /config returns the default config when nothing is stored', async () => {
    const res = await request(app.getHttpServer()).get('/config');
    expect({ status: res.status, body: res.body }).toEqual({
      status: 200,
      body: { periods: ['1h', '1d'], defaultPeriod: '1d' },
    });
  });

  it('PUT /config replaces and the value persists for a fresh connection', async () => {
    const put = await request(app.getHttpServer())
      .put('/config')
      .send({ periods: ['1h', '4h', '1d'], defaultPeriod: '4h' });
    expect(put.status).toBe(200);

    const fresh = await bootApp();
    const get = await request(fresh.getHttpServer()).get('/config');
    expect({ status: get.status, body: get.body }).toEqual({
      status: 200,
      body: { periods: ['1h', '4h', '1d'], defaultPeriod: '4h' },
    });
    await fresh.close();
  });

  it('PATCH /config merges over the current config', async () => {
    const res = await request(app.getHttpServer()).patch('/config').send({ defaultPeriod: '1d' });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 200,
      body: { periods: ['1h', '4h', '1d'], defaultPeriod: '1d' },
    });
  });

  it('PUT /config rejects an invalid body with 400', async () => {
    const res = await request(app.getHttpServer())
      .put('/config')
      .send({ periods: [], defaultPeriod: '1d' });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 400,
      body: { error: 'periods must not be empty' },
    });
  });
});
