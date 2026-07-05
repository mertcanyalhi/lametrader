import {
  BOT_TOKEN_MAX,
  CHAT_ID_MAX,
  DESTINATION_NAME_MAX,
  NotificationChannel,
} from '@lametrader/core';
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, Length } from 'class-validator';

/**
 * The `POST /config/notifications` request body — the write shape of a
 * notification config.
 *
 * Lazy: a flat Telegram-shaped body gated by `notificationType`. Telegram is
 * the only channel today; a discriminated (`@Type`) per-channel payload lands
 * with the second channel. The domain re-trims and re-checks on create,
 * surfacing a `{ error }` 400 for whitespace-only input.
 */
export class CreateNotificationConfigDto {
  /**
   * The channel discriminator (immutable once created).
   */
  @ApiProperty({ enum: NotificationChannel })
  @IsEnum(NotificationChannel)
  notificationType!: NotificationChannel;

  /**
   * Human-readable, unique alias rules pick from a dropdown (e.g. `"main"`).
   */
  @ApiProperty({ minLength: 1, maxLength: DESTINATION_NAME_MAX })
  @IsString()
  @Length(1, DESTINATION_NAME_MAX)
  name!: string;

  /**
   * Bot API token (sensitive; never logged, never echoed on reads).
   */
  @ApiProperty({ minLength: 1, maxLength: BOT_TOKEN_MAX })
  @IsString()
  @Length(1, BOT_TOKEN_MAX)
  botToken!: string;

  /**
   * Target chat id the bot sends messages to.
   */
  @ApiProperty({ minLength: 1, maxLength: CHAT_ID_MAX })
  @IsString()
  @Length(1, CHAT_ID_MAX)
  chatId!: string;
}
