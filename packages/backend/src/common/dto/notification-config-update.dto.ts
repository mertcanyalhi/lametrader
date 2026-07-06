import { BOT_TOKEN_MAX, CHAT_ID_MAX, DESTINATION_NAME_MAX } from '@lametrader/core';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

/**
 * The `PATCH /config/notifications/:id` request body — a partial update.
 *
 * `notificationType` is **immutable** and deliberately absent: the global
 * validation pipe (`forbidNonWhitelisted`) rejects a body carrying it with a
 * 400, so the discriminator cannot be changed via `PATCH`. `id` is likewise
 * route-only, never a body field.
 */
export class UpdateNotificationConfigDto {
  /**
   * New name (must stay unique across configs).
   */
  @ApiPropertyOptional({ minLength: 1, maxLength: DESTINATION_NAME_MAX })
  @IsOptional()
  @IsString()
  @Length(1, DESTINATION_NAME_MAX)
  name?: string;

  /**
   * New bot token; omit to keep the stored one (it is never read back).
   */
  @ApiPropertyOptional({ minLength: 1, maxLength: BOT_TOKEN_MAX })
  @IsOptional()
  @IsString()
  @Length(1, BOT_TOKEN_MAX)
  botToken?: string;

  /**
   * New target chat id.
   */
  @ApiPropertyOptional({ minLength: 1, maxLength: CHAT_ID_MAX })
  @IsOptional()
  @IsString()
  @Length(1, CHAT_ID_MAX)
  chatId?: string;
}
