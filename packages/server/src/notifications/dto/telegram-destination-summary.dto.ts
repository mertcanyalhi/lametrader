import { ApiProperty } from '@nestjs/swagger';

/**
 * The read/response shape of a Telegram destination — name + chat id only.
 *
 * The sensitive `botToken` is never read back from the server, so it is absent
 * from both the list read and the upsert response.
 */
export class TelegramDestinationSummaryDto {
  /**
   * The destination's human-readable name.
   */
  @ApiProperty()
  name!: string;

  /**
   * Target chat id (non-sensitive — surfaces in the editor's preview).
   */
  @ApiProperty()
  chatId!: string;
}
