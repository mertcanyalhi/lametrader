import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

/**
 * E2E for the generic `/config/notifications` resource from the API consumer's
 * perspective: the real Nest app over a real Mongo (Testcontainers), exercised
 * over HTTP.
 *
 * Storage is folded into the shared config K/V store, so the round-trip also
 * verifies the `ConfigKey.Notifications` key persists across connections.
 */
describe('config notifications API (e2e)', () => {
  let app: INestApplication;

  /** Boot a fresh Nest app against the shared container (a "new connection"). */
  async function bootApp(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const nestApp = moduleRef.createNestApplication();
    await nestApp.init();
    return nestApp;
  }

  beforeAll(async () => {
    app = await bootApp();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('round-trips a create across a fresh connection (persists in the K/V store)', async () => {
    const post = await request(app.getHttpServer())
      .post('/config/notifications')
      .send({ notificationType: 'telegram', name: 'main', botToken: 'TOKEN-1', chatId: '123' });
    expect({ status: post.status, body: post.body }).toEqual({
      status: 201,
      body: { id: expect.any(String), notificationType: 'telegram', name: 'main', chatId: '123' },
    });

    const fresh = await bootApp();
    const get = await request(fresh.getHttpServer()).get(`/config/notifications/${post.body.id}`);
    expect({ status: get.status, body: get.body }).toEqual({
      status: 200,
      body: { id: post.body.id, notificationType: 'telegram', name: 'main', chatId: '123' },
    });
    await fresh.close();
  });

  it('supports the PATCH then DELETE lifecycle; a second DELETE returns 404', async () => {
    const post = await request(app.getHttpServer())
      .post('/config/notifications')
      .send({ notificationType: 'telegram', name: 'doomed', botToken: 'TOKEN-X', chatId: '999' });
    const id = post.body.id;

    const patched = await request(app.getHttpServer())
      .patch(`/config/notifications/${id}`)
      .send({ chatId: '111' });
    const first = await request(app.getHttpServer()).delete(`/config/notifications/${id}`);
    const second = await request(app.getHttpServer()).delete(`/config/notifications/${id}`);

    expect({
      patched: { status: patched.status, chatId: patched.body.chatId },
      first: first.status,
      second: second.status,
    }).toEqual({
      patched: { status: 200, chatId: '111' },
      first: 204,
      second: 404,
    });
  });
});
