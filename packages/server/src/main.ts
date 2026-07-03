import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config/app-config.types.js';

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

  const config = app.get(ConfigService<AppConfig, true>);
  await app.listen(config.get('port', { infer: true }), '0.0.0.0');
}

void bootstrap();
