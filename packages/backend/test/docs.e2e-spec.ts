import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { setupSwagger } from '../src/swagger.js';

/**
 * E2E for the OpenAPI docs surface: the Swagger UI at `/docs` and the raw spec
 * at `/docs/json`, matching the old Fastify entry points.
 */
describe('OpenAPI docs (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupSwagger(app);
    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('serves the Swagger UI at /docs', async () => {
    const res = await request(app.getHttpServer()).get('/docs').redirects(1);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Swagger UI');
  });

  it('serves the raw OpenAPI document at /docs/json with the config paths', async () => {
    const res = await request(app.getHttpServer()).get('/docs/json');
    expect(res.status).toBe(200);
    expect({
      openapi: typeof res.body.openapi,
      hasConfig: Object.hasOwn(res.body.paths, '/config'),
      hasTelegram: Object.hasOwn(res.body.paths, '/config/notifications/telegram'),
    }).toEqual({ openapi: 'string', hasConfig: true, hasTelegram: true });
  });
});
