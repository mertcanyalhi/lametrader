import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigController } from './config.controller.js';
import { ConfigService } from './config.service.js';
import { ConfigEntry, ConfigEntrySchema } from './config-entry.schema.js';
import { CONFIG_REPOSITORY } from './config-repository.token.js';
import { MongooseConfigRepository } from './mongoose-config.repository.js';

/**
 * The `/config` feature module.
 *
 * Owns the shared config key-value store (the `config` collection): it registers
 * the {@link ConfigEntry} model, binds the {@link CONFIG_REPOSITORY} port to its
 * Mongoose adapter, and drives the {@link ConfigService} behind
 * {@link ConfigController}.
 *
 * Both the repository port and the service are exported so the notifications
 * module (whose Telegram destinations live under the same K/V key) reuses the
 * one store rather than opening a second collection.
 */
@Module({
  imports: [MongooseModule.forFeature([{ name: ConfigEntry.name, schema: ConfigEntrySchema }])],
  controllers: [ConfigController],
  providers: [ConfigService, { provide: CONFIG_REPOSITORY, useClass: MongooseConfigRepository }],
  exports: [ConfigService, CONFIG_REPOSITORY],
})
export class ConfigModule {}
