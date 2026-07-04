import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { CandlesModule } from './candles/candles.module.js';
import { DomainExceptionFilter } from './common/domain-exception.filter.js';
import { buildValidationPipe } from './common/validation.pipe.js';
import { ConfigModule } from './config/config.module.js';
import { validateEnv } from './config/env.validation.js';
import { HealthModule } from './health/health.module.js';
import { LoggingModule } from './logging/logging.module.js';
import { MongoModule } from './mongo/mongo.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { ProfilesModule } from './profiles/profiles.module.js';
import { StateModule } from './state/state.module.js';
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
 * {@link NotificationsModule} (`/config/notifications/telegram`),
 * {@link ProfilesModule} (`/profiles` + attached indicators),
 * {@link CandlesModule} (`/symbols/:id/candles` + `/backfill`; owns the shared
 * candle store), {@link SymbolsModule} (`/instruments` + `/symbols`; imports
 * {@link ProfilesModule} for the symbol-removal → profile-prune cascade and
 * {@link CandlesModule} for the candle store), and {@link StateModule}
 * (`/profiles/:profileId/state/global` + `/symbols/:id/state` reads; owns the
 * shared state store).
 */
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    // The dynamic-timeout registry the (dormant) candle PollingService drives;
    // `forRoot` registers the global SchedulerRegistry. No decorator-based jobs.
    ScheduleModule.forRoot(),
    LoggingModule,
    MongoModule,
    HealthModule,
    ConfigModule,
    NotificationsModule,
    ProfilesModule,
    CandlesModule,
    SymbolsModule,
    StateModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
    { provide: APP_PIPE, useFactory: buildValidationPipe },
  ],
})
export class AppModule {}
