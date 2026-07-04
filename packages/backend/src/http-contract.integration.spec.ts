import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ConfigController } from './common/controllers/config.controller.js';
import { NotificationsController } from './common/controllers/notifications.controller.js';
import { DomainExceptionFilter } from './common/domain-exception.filter.js';
import { CONFIG_REPOSITORY } from './common/interfaces/config-repository.token.js';
import { InMemoryConfigRepository } from './common/persistence/in-memory-config.repository.js';
import { ConfigService } from './common/services/config.service.js';
import { TelegramDestinationsService } from './common/services/telegram-destinations.service.js';
import { buildValidationPipe } from './common/validation.pipe.js';

/**
 * Local (Docker-free) integration proof of the app-wide HTTP contract: the
 * config + notifications controllers behind the real global validation pipe and
 * exception filter, over an in-memory config store. Pins routes, verbs, status
 * codes, and the `{ error, fields }` envelope so the container-backed e2e tier
 * only has to prove the Mongo wiring.
 */
describe('config + notifications HTTP contract (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ConfigController, NotificationsController],
      providers: [
        ConfigService,
        TelegramDestinationsService,
        { provide: CONFIG_REPOSITORY, useValue: new InMemoryConfigRepository() },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(buildValidationPipe());
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.init();
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

  it('POST /config/notifications/telegram upserts and returns 200 with the summary', async () => {
    const res = await request(app.getHttpServer())
      .post('/config/notifications/telegram')
      .send({ name: 'main', botToken: 'TOKEN-1', chatId: '123' });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 200,
      body: { name: 'main', chatId: '123' },
    });
  });

  it('POST /config/notifications/telegram surfaces a whitespace-only name as a domain 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/config/notifications/telegram')
      .send({ name: '   ', botToken: 'T', chatId: '1' });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 400,
      body: { error: 'name is required' },
    });
  });

  it('POST /config/notifications/telegram rejects an empty name with the validation envelope', async () => {
    const res = await request(app.getHttpServer())
      .post('/config/notifications/telegram')
      .send({ name: '', botToken: 'T', chatId: '1' });
    expect({
      status: res.status,
      error: res.body.error,
      paths: res.body.fields.map((f: { path: string }) => f.path),
    }).toEqual({ status: 400, error: 'Validation failed', paths: ['name'] });
  });

  it('DELETE /config/notifications/telegram/:name returns 404 for an unknown name', async () => {
    const res = await request(app.getHttpServer()).delete('/config/notifications/telegram/ghost');
    expect({ status: res.status, body: res.body }).toEqual({
      status: 404,
      body: { error: 'No telegram destination named "ghost"' },
    });
  });

  it('DELETE /config/notifications/telegram/:name returns 204 when it removes an existing one', async () => {
    await request(app.getHttpServer())
      .post('/config/notifications/telegram')
      .send({ name: 'doomed', botToken: 'T', chatId: '9' });
    const res = await request(app.getHttpServer()).delete('/config/notifications/telegram/doomed');
    expect({ status: res.status, body: res.body }).toEqual({ status: 204, body: {} });
  });
});
