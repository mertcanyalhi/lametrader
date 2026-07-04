import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

/**
 * E2E for the config-notifications sub-resource from the API consumer's
 * perspective: the real Nest app over a real Mongo (Testcontainers), exercised
 * over HTTP under `/config/notifications/telegram`.
 *
 * Storage is folded into the shared config K/V store, so the round-trip also
 * verifies the `ConfigKey.TelegramDestinations` key persists across
 * connections. Mirrors the old Fastify `notifications.e2e.test.ts`.
 */
describe('config notifications API (e2e)', () => {
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

  it('round-trips an upsert across a fresh connection (persists in the K/V store)', async () => {
    const post = await request(app.getHttpServer())
      .post('/config/notifications/telegram')
      .send({ name: 'main', botToken: 'TOKEN-1', chatId: '123' });
    expect({ status: post.status, body: post.body }).toEqual({
      status: 200,
      body: { name: 'main', chatId: '123' },
    });

    const fresh = await bootApp();
    const get = await request(fresh.getHttpServer()).get('/config/notifications/telegram');
    expect({ status: get.status, body: get.body }).toEqual({
      status: 200,
      body: [{ name: 'main', chatId: '123' }],
    });
    await fresh.close();
  });

  it('DELETE removes the destination and a second DELETE returns 404', async () => {
    await request(app.getHttpServer())
      .post('/config/notifications/telegram')
      .send({ name: 'doomed', botToken: 'TOKEN-X', chatId: '999' });

    const first = await request(app.getHttpServer()).delete(
      '/config/notifications/telegram/doomed',
    );
    const second = await request(app.getHttpServer()).delete(
      '/config/notifications/telegram/doomed',
    );

    expect({ first: first.status, second: second.status }).toEqual({
      first: 204,
      second: 404,
    });
  });
});
