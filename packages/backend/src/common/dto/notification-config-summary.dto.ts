import { NotificationChannel } from '@lametrader/core';
import { ApiProperty } from '@nestjs/swagger';

/**
 * The list projection of a notification config — the common shape only
 * (`id`, `notificationType`, `name`). What `GET /config/notifications` returns;
 * no channel-specific or sensitive fields.
 */
export class NotificationConfigSummaryDto {
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
}
