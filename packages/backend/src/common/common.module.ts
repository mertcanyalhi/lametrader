import { Module } from '@nestjs/common';
import { ConfigService as EnvConfigService } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { LoggerModule } from 'nestjs-pino';
import { ConfigController } from './controllers/config.controller.js';
import { HealthController } from './controllers/health.controller.js';
import { NotificationsController } from './controllers/notifications.controller.js';
import { DomainExceptionFilter } from './domain-exception.filter.js';
import type { AppConfig } from './interfaces/app-config.types.js';
import { CONFIG_REPOSITORY } from './interfaces/config-repository.token.js';
import { EVENT_LOG } from './interfaces/event-log.token.js';
import {
  CANDLE_STREAM,
  INDICATOR_STREAM,
  QUOTE_STREAM,
  RULE_EVENT_STREAM,
} from './interfaces/stream.tokens.js';
import { SYMBOL_EVENT_LOG } from './interfaces/symbol-event-log.token.js';
import { ConfigEntry, ConfigEntrySchema } from './persistence/config-entry.schema.js';
import { MongooseConfigRepository } from './persistence/mongoose-config.repository.js';
import { MongooseEventLog } from './persistence/mongoose-event-log.js';
import { RuleEventDoc, RuleEventDocSchema } from './persistence/rule-event-doc.schema.js';
import { SymbolEventDoc, SymbolEventDocSchema } from './persistence/symbol-event-doc.schema.js';
import { ConfigService } from './services/config.service.js';
import { HealthService } from './services/health.service.js';
import { streamHubProviders } from './services/stream-hubs.js';
import { TelegramDestinationsService } from './services/telegram-destinations.service.js';
import { TelegramNotifier, telegramNotifierFactory } from './services/telegram-notifier.js';
import { buildValidationPipe } from './validation.pipe.js';

/**
 * The cross-cutting infra context — the leaf every feature context depends on.
 *
 * It owns the platform plumbing that carries no domain of its own — the root
 * MongoDB connection, `nestjs-pino` structured logging, the `GET /health`
 * probe, and the app-wide HTTP contract (the global {@link DomainExceptionFilter}
 * and `ValidationPipe`, registered as `APP_FILTER` / `APP_PIPE`) — plus the
 * shared leaves that sit *below* more than one feature context and so cannot
 * live in any single one without a cycle:
 *
 * - the **`/config` settings feature** ({@link ConfigService} + {@link ConfigController}),
 *   read by Market (supported/default periods) and Delivery;
 * - the **event log** ({@link EVENT_LOG} / {@link SYMBOL_EVENT_LOG}), written by
 *   the Analytics rule engine and read by Delivery's rule-event stream;
 * - **telegram notifications** ({@link TelegramNotifier} + its `/config/notifications/telegram`
 *   destinations feature), sent by the Analytics rule engine.
 *
 * Every shared token is bound and exported here exactly once, so each dependent
 * context imports this module and resolves the one shared instance — the
 * shared-persistence discipline of ADR-0018, now hosted by the context leaf
 * rather than a per-resource module (ADR-0019).
 *
 * The activation seam ({@link import('../live-cascade.service.js').LiveCascadeService})
 * is *not* here — it injects producers from every context, so it lives at the
 * composition root (`AppModule`), not in this leaf.
 */
@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [EnvConfigService],
      useFactory: (config: EnvConfigService<AppConfig, true>) => ({
        uri: config.get('mongoUri', { infer: true }),
      }),
    }),
    LoggerModule.forRootAsync({
      inject: [EnvConfigService],
      useFactory: (config: EnvConfigService<AppConfig, true>) => ({
        pinoHttp: {
          level: config.get('logLevel', { infer: true }),
          base: { app: 'server' },
        },
      }),
    }),
    MongooseModule.forFeature([
      { name: ConfigEntry.name, schema: ConfigEntrySchema },
      { name: RuleEventDoc.name, schema: RuleEventDocSchema },
      { name: SymbolEventDoc.name, schema: SymbolEventDocSchema },
    ]),
  ],
  controllers: [HealthController, ConfigController, NotificationsController],
  providers: [
    HealthService,
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
    { provide: APP_PIPE, useFactory: buildValidationPipe },
    ConfigService,
    { provide: CONFIG_REPOSITORY, useClass: MongooseConfigRepository },
    {
      provide: EVENT_LOG,
      useFactory: (rules: Model<RuleEventDoc>, symbols: Model<SymbolEventDoc>) =>
        new MongooseEventLog(rules, symbols),
      inject: [getModelToken(RuleEventDoc.name), getModelToken(SymbolEventDoc.name)],
    },
    { provide: SYMBOL_EVENT_LOG, useExisting: EVENT_LOG },
    TelegramDestinationsService,
    {
      provide: TelegramNotifier,
      useFactory: telegramNotifierFactory,
      inject: [TelegramDestinationsService],
    },
    ...streamHubProviders,
  ],
  exports: [
    ConfigService,
    CONFIG_REPOSITORY,
    EVENT_LOG,
    SYMBOL_EVENT_LOG,
    TelegramDestinationsService,
    TelegramNotifier,
    CANDLE_STREAM,
    INDICATOR_STREAM,
    QUOTE_STREAM,
    RULE_EVENT_STREAM,
  ],
})
export class CommonModule {}
