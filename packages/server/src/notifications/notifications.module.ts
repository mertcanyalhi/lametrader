import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.js';
import { NotificationsController } from './notifications.controller.js';
import { TelegramDestinationsService } from './telegram-destinations.service.js';
import { TelegramNotifier, telegramNotifierFactory } from './telegram-notifier.js';

/**
 * The Telegram notifications feature module.
 *
 * Imports {@link ConfigModule} to reuse its config K/V store (the destinations
 * live under the same collection), drives the destinations CRUD behind
 * {@link NotificationsController}, and registers the {@link TelegramNotifier}
 * (built from the destinations service via a factory) for later rule-engine
 * consumption.
 */
@Module({
  imports: [ConfigModule],
  controllers: [NotificationsController],
  providers: [
    TelegramDestinationsService,
    {
      provide: TelegramNotifier,
      useFactory: telegramNotifierFactory,
      inject: [TelegramDestinationsService],
    },
  ],
  exports: [TelegramDestinationsService, TelegramNotifier],
})
export class NotificationsModule {}
