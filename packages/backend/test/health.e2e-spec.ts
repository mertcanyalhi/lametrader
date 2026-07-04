import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

describe('GET /health (e2e)', () => {
  let container: StartedMongoDBContainer;
  let app: INestApplication;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8').start();
    // Point the app's Mongo connection at the throwaway container.  A
    // single-node replica set needs `directConnection` so the driver talks to
    // it without discovering (absent) replica-set peers.
    process.env.MONGODB_URI = `${container.getConnectionString()}/?directConnection=true`;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await container?.stop();
  });

  it('returns 200 with an ok status once the app has booted against Mongo', async () => {
    const response = await request(app.getHttpServer()).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
