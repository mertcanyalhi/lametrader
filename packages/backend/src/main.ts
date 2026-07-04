import 'reflect-metadata';
import { createRequire } from 'node:module';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config/app-config.types.js';
import { LiveCascadeService } from './runtime/live-cascade.service.js';
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
 *
 * Live activation mirrors the old `api/main.ts` order exactly: stand the app up,
 * enable shutdown hooks, `listen`, then start the producers. The
 * {@link LiveCascadeService} start happens **only here**, after `listen`, so the
 * e2e suites — which build the app via `Test.createTestingModule` and never reach
 * this function — stay dormant and touch no real market-data provider. Shutdown
 * hooks (`enableShutdownHooks`) turn a SIGINT/SIGTERM into `app.close()`, which
 * fires {@link LiveCascadeService.onApplicationShutdown} (stop polling, detach the
 * cascade) and the Mongoose shutdown hook (close the connection).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // The global exception filter + validation pipe are wired as APP_FILTER /
  // APP_PIPE providers in AppModule, so they apply here and in the e2e tests
  // alike; only the OpenAPI docs (an app-level, non-DI concern) are mounted here.
  setupSwagger(app, SERVER_VERSION);

  // Route OS termination signals through `app.close()` so the cascade stops and
  // Mongo closes cleanly (parity with the old main.ts SIGINT/SIGTERM handler).
  app.enableShutdownHooks();

  const config = app.get(ConfigService<AppConfig, true>);
  await app.listen(config.get('port', { infer: true }), '0.0.0.0');

  // Go live only after the server is listening — start the poll loop, rule
  // engine, and the poll→producers + indicator→rule cascades.
  await app.get(LiveCascadeService).start();
}

void bootstrap();
