import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import type { AppConfig } from '../config/app-config.types.js';

/**
 * Opens the root MongoDB connection from the validated config.
 *
 * This is deliberately just the connection — no schemas, models, or
 * repositories.
 * Feature modules register their own schemas with `MongooseModule.forFeature`
 * against this shared connection as they are ported (spec stage 3).
 */
@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        uri: config.get('mongoUri', { infer: true }),
      }),
    }),
  ],
})
export class MongoModule {}
