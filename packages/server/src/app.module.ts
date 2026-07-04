import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { DomainExceptionFilter } from './common/domain-exception.filter.js';
import { buildValidationPipe } from './common/validation.pipe.js';
import { ConfigModule } from './config/config.module.js';
import { validateEnv } from './config/env.validation.js';
import { HealthModule } from './health/health.module.js';
import { LoggingModule } from './logging/logging.module.js';
import { MongoModule } from './mongo/mongo.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { SymbolsModule } from './symbols/symbols.module.js';

/**
 * The application root module — the composition root of the Nest monolith.
 *
 * Wires the cross-cutting glue every feature module plugs into: validated
 * environment configuration ({@link NestConfigModule}, global), structured
 * logging, the root Mongo connection, the health endpoint, and — the keystone
 * for every resource — the app-wide HTTP contract: a global {@link DomainExceptionFilter}
 * (domain error → status mapping + uniform `{ error, fields }` envelope) and a
 * global `ValidationPipe` (DTO validation emitting the same envelope).
 *
 * Feature modules: {@link ConfigModule} (`/config`),
 * {@link NotificationsModule} (`/config/notifications/telegram`), and
 * {@link SymbolsModule} (`/instruments` + `/symbols`).
 */
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    LoggingModule,
    MongoModule,
    HealthModule,
    ConfigModule,
    NotificationsModule,
    SymbolsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
    { provide: APP_PIPE, useFactory: buildValidationPipe },
  ],
})
export class AppModule {}
