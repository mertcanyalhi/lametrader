import { BOT_TOKEN_MAX, CHAT_ID_MAX, DESTINATION_NAME_MAX } from '@lametrader/core';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

/**
 * The `POST /config/notifications/telegram` request body — the write shape of a
 * Telegram destination.
 *
 * Field-level bounds mirror the old TypeBox schema (each non-empty, within its
 * length cap); the domain re-trims and re-checks on upsert, surfacing a
 * `{ error }` 400 for whitespace-only input.
 */
export class TelegramDestinationInputDto {
  /**
   * Human-readable identifier rules pick from a dropdown (e.g. `"main"`).
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
