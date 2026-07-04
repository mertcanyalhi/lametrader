import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { LoggerModule } from 'nestjs-pino';
import type { AppConfig } from '../config/app-config.types.js';
import { HealthController } from './controllers/health.controller.js';
import { DomainExceptionFilter } from './domain-exception.filter.js';
import { HealthService } from './services/health.service.js';
import { buildValidationPipe } from './validation.pipe.js';

/**
 * The cross-cutting infra context — the leaf every feature context depends on.
 *
 * It owns the platform plumbing that carries no domain of its own: the root
 * MongoDB connection (the shared connection feature modules register their
 * schemas against with `MongooseModule.forFeature`), `nestjs-pino` structured
 * logging (root level from {@link AppConfig.logLevel}, `{ app: 'server' }` base
 * field), the `GET /health` liveness probe, and the app-wide HTTP contract —
 * the global {@link DomainExceptionFilter} (domain error → status + uniform
 * `{ error, fields }` envelope) and the global `ValidationPipe` (DTO validation
 * emitting the same envelope), both registered here as `APP_FILTER` / `APP_PIPE`
 * so they apply to every resource.
 *
 * This module imports no feature context, so the module graph's
 * `Delivery → Analytics → Market → Common` direction terminates here.
 * The activation seam that wires the live producer cascade
 * ({@link import('../live-cascade.service.js').LiveCascadeService}) is *not*
 * here — it depends on every context, so it lives at the composition root
 * (`AppModule`), not in this leaf.
 */
@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        uri: config.get('mongoUri', { infer: true }),
      }),
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        pinoHttp: {
          level: config.get('logLevel', { infer: true }),
          base: { app: 'server' },
        },
      }),
    }),
  ],
  controllers: [HealthController],
  providers: [
    HealthService,
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
    { provide: APP_PIPE, useFactory: buildValidationPipe },
  ],
})
export class CommonModule {}
