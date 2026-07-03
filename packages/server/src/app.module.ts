import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation.js';
import { HealthModule } from './health/health.module.js';
import { LoggingModule } from './logging/logging.module.js';
import { MongoModule } from './mongo/mongo.module.js';

/**
 * The application root module — the composition root of the Nest monolith.
 *
 * Wires the cross-cutting glue every later feature module plugs into: validated
 * configuration (global), structured logging, the root Mongo connection, and the
 * health endpoint.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    LoggingModule,
    MongoModule,
    HealthModule,
  ],
})
export class AppModule {}
