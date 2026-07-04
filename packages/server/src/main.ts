import 'reflect-metadata';
import { createRequire } from 'node:module';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config/app-config.types.js';
import { setupSwagger } from './swagger.js';

/**
 * The server package's own version, read from its `package.json` so the OpenAPI
 * document reports the real release rather than a hard-coded literal that drifts.
 */
const { version: SERVER_VERSION } = createRequire(import.meta.url)('../package.json') as {
  version: string;
};

/**
 * Boot the Nest application on the Express platform and start serving.
 *
 * `bufferLogs` holds early framework logs until `nestjs-pino`'s logger is
 * installed, so bootstrap logs go through the same structured sink as everything
 * else.
 * No polling, scheduler, or background loop is started here — this stage only
 * stands the app up; runtime loops arrive with their feature modules.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // The global exception filter + validation pipe are wired as APP_FILTER /
  // APP_PIPE providers in AppModule, so they apply here and in the e2e tests
  // alike; only the OpenAPI docs (an app-level, non-DI concern) are mounted here.
  setupSwagger(app, SERVER_VERSION);

  const config = app.get(ConfigService<AppConfig, true>);
  await app.listen(config.get('port', { infer: true }), '0.0.0.0');
}

void bootstrap();
