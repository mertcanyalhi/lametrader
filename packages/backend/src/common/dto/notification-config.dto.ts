import { NotificationChannel } from '@lametrader/core';
import { ApiProperty } from '@nestjs/swagger';

/**
 * The single-config read view — every non-sensitive field, including the
 * channel-specific ones (Telegram's `chatId`), with the sensitive `botToken`
 * stripped. What `GET /config/notifications/:id`, `POST`, and `PATCH` return.
 */
export class NotificationConfigDto {
  /**
   * The config's stable id (the REST `:id`).
   */
  @ApiProperty()
  id!: string;

  /**
   * The config's channel.
   */
  @ApiProperty({ enum: NotificationChannel })
  notificationType!: NotificationChannel;

  /**
   * The config's human-readable name.
   */
  @ApiProperty()
  name!: string;

  /**
   * Target chat id (non-sensitive — surfaces in the editor's preview).
   */
  @ApiProperty()
  chatId!: string;
}
