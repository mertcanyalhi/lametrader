import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ConfigController } from './common/controllers/config.controller.js';
import { NotificationsController } from './common/controllers/notifications.controller.js';
import { DomainExceptionFilter } from './common/domain-exception.filter.js';
import { CONFIG_REPOSITORY } from './common/interfaces/config-repository.token.js';
import { InMemoryConfigRepository } from './common/persistence/in-memory-config.repository.js';
import { ConfigService } from './common/services/config.service.js';
import { NotificationConfigsService } from './common/services/notification-configs.service.js';
import { buildValidationPipe } from './common/validation.pipe.js';

/** Build a booted app with the config + notifications controllers over a fresh store. */
async function buildApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [ConfigController, NotificationsController],
    providers: [
      ConfigService,
      NotificationConfigsService,
      { provide: CONFIG_REPOSITORY, useValue: new InMemoryConfigRepository() },
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(buildValidationPipe());
  app.useGlobalFilters(new DomainExceptionFilter());
  await app.init();
  return app;
}

/**
 * Local (Docker-free) integration proof of the app-wide HTTP contract: the
 * config + notifications controllers behind the real global validation pipe and
 * exception filter, over an in-memory config store. Pins routes, verbs, status
 * codes, and the `{ error, fields }` envelope so the container-backed e2e tier
 * only has to prove the Mongo wiring.
 */
describe('config HTTP contract (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /config returns the default config', async () => {
    const res = await request(app.getHttpServer()).get('/config');
    expect({ status: res.status, body: res.body }).toEqual({
      status: 200,
      body: { periods: ['1h', '1d'], defaultPeriod: '1d' },
    });
  });

  it('PUT /config replaces the config and returns it', async () => {
    const res = await request(app.getHttpServer())
      .put('/config')
      .send({ periods: ['1h', '4h', '1d'], defaultPeriod: '4h' });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 200,
      body: { periods: ['1h', '4h', '1d'], defaultPeriod: '4h' },
    });
  });

  it('PUT /config surfaces a domain rule failure as a bare { error } 400', async () => {
    const res = await request(app.getHttpServer())
      .put('/config')
      .send({ periods: [], defaultPeriod: '1d' });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 400,
      body: { error: 'periods must not be empty' },
    });
  });

  it('PUT /config rejects a bad enum value with the { error, fields } validation envelope', async () => {
    const res = await request(app.getHttpServer())
      .put('/config')
      .send({ periods: ['bogus'], defaultPeriod: '1d' });
    expect({
      status: res.status,
      error: res.body.error,
      paths: res.body.fields.map((f: { path: string }) => f.path),
    }).toEqual({ status: 400, error: 'Validation failed', paths: ['periods'] });
  });

  it('PUT /config rejects an unknown property (additionalProperties: false) with a 400', async () => {
    const res = await request(app.getHttpServer())
      .put('/config')
      .send({ periods: ['1h'], defaultPeriod: '1h', bogus: 1 });
    expect({
      status: res.status,
      error: res.body.error,
      paths: res.body.fields.map((f: { path: string }) => f.path),
    }).toEqual({ status: 400, error: 'Validation failed', paths: ['bogus'] });
  });
});

describe('config notifications HTTP contract (integration)', () => {
  let app: INestApplication;

  /** A fresh app + store per test, so accumulated configs never leak across tests. */
  beforeEach(async () => {
    app = await buildApp();
  });

  afterEach(async () => {
    await app?.close();
  });

  /** POST a valid Telegram config; returns supertest's response. */
  function createMain() {
    return request(app.getHttpServer())
      .post('/config/notifications')
      .send({ notificationType: 'telegram', name: 'main', botToken: 'TOKEN-1', chatId: '123' });
  }

  it('POST creates a config and returns 201 with the view (no bot token)', async () => {
    const res = await createMain();
    expect({ status: res.status, body: res.body }).toEqual({
      status: 201,
      body: { id: expect.any(String), notificationType: 'telegram', name: 'main', chatId: '123' },
    });
  });

  it('POST a duplicate name returns 409', async () => {
    await createMain();
    const res = await request(app.getHttpServer())
      .post('/config/notifications')
      .send({ notificationType: 'telegram', name: 'main', botToken: 'T', chatId: '9' });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 409,
      body: { error: 'A notification named "main" already exists' },
    });
  });

  it('POST a whitespace-only name surfaces a domain 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/config/notifications')
      .send({ notificationType: 'telegram', name: '   ', botToken: 'T', chatId: '1' });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 400,
      body: { error: 'name is required' },
    });
  });

  it('POST an empty name is rejected with the validation envelope', async () => {
    const res = await request(app.getHttpServer())
      .post('/config/notifications')
      .send({ notificationType: 'telegram', name: '', botToken: 'T', chatId: '1' });
    expect({
      status: res.status,
      error: res.body.error,
      paths: res.body.fields.map((f: { path: string }) => f.path),
    }).toEqual({ status: 400, error: 'Validation failed', paths: ['name'] });
  });

  it('POST an unknown notificationType is rejected with the validation envelope', async () => {
    const res = await request(app.getHttpServer())
      .post('/config/notifications')
      .send({ notificationType: 'carrier-pigeon', name: 'x', botToken: 'T', chatId: '1' });
    expect({
      status: res.status,
      error: res.body.error,
      paths: res.body.fields.map((f: { path: string }) => f.path),
    }).toEqual({ status: 400, error: 'Validation failed', paths: ['notificationType'] });
  });

  it('GET lists summaries (id + type + name; no bot token, no chat id)', async () => {
    const created = await createMain();
    const res = await request(app.getHttpServer()).get('/config/notifications');
    expect({ status: res.status, body: res.body }).toEqual({
      status: 200,
      body: [{ id: created.body.id, notificationType: 'telegram', name: 'main' }],
    });
  });

  it('GET /:id returns the view; an unknown id is a 404', async () => {
    const created = await createMain();
    const ok = await request(app.getHttpServer()).get(`/config/notifications/${created.body.id}`);
    const missing = await request(app.getHttpServer()).get('/config/notifications/ghost');
    expect({
      ok: { status: ok.status, body: ok.body },
      missing: missing.status,
    }).toEqual({
      ok: {
        status: 200,
        body: { id: created.body.id, notificationType: 'telegram', name: 'main', chatId: '123' },
      },
      missing: 404,
    });
  });

  it('PATCH updates and returns 200 with the view; an unknown id is a 404', async () => {
    const created = await createMain();
    const ok = await request(app.getHttpServer())
      .patch(`/config/notifications/${created.body.id}`)
      .send({ chatId: '456' });
    const missing = await request(app.getHttpServer())
      .patch('/config/notifications/ghost')
      .send({ chatId: '1' });
    expect({
      ok: { status: ok.status, body: ok.body },
      missing: missing.status,
    }).toEqual({
      ok: {
        status: 200,
        body: { id: created.body.id, notificationType: 'telegram', name: 'main', chatId: '456' },
      },
      missing: 404,
    });
  });

  it('PATCH carrying notificationType is rejected 400 (the discriminator is immutable)', async () => {
    const created = await createMain();
    const res = await request(app.getHttpServer())
      .patch(`/config/notifications/${created.body.id}`)
      .send({ notificationType: 'telegram' });
    expect({
      status: res.status,
      error: res.body.error,
      paths: res.body.fields.map((f: { path: string }) => f.path),
    }).toEqual({ status: 400, error: 'Validation failed', paths: ['notificationType'] });
  });

  it('DELETE removes the config (204) and a second DELETE returns 404', async () => {
    const created = await createMain();
    const first = await request(app.getHttpServer()).delete(
      `/config/notifications/${created.body.id}`,
    );
    const second = await request(app.getHttpServer()).delete(
      `/config/notifications/${created.body.id}`,
    );
    expect({ first: first.status, second: second.status }).toEqual({ first: 204, second: 404 });
  });
});
