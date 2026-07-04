import type { TelegramDestinationSummary } from '@lametrader/core';
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { TelegramDestinationInputDto } from '../dto/telegram-destination-input.dto.js';
import { TelegramDestinationSummaryDto } from '../dto/telegram-destination-summary.dto.js';
import { TelegramDestinationsService } from '../services/telegram-destinations.service.js';

/**
 * The Telegram notification destinations, a sub-resource of `/config`.
 *
 * Telegram is the only channel today; the `/config/notifications` prefix keeps
 * room for siblings (e.g. `/slack`) without growing top-level routes.
 *
 * - `GET /config/notifications/telegram` — list (no bot tokens).
 * - `POST /config/notifications/telegram` — upsert by `name` (**200**).
 * - `DELETE /config/notifications/telegram/:name` — remove (**204** / 404).
 *
 * Bot tokens are never read back; the upsert returns the non-sensitive summary.
 */
@ApiTags('config')
@Controller('config/notifications/telegram')
export class NotificationsController {
  /**
   * @param destinations - the destinations use-case to drive.
   */
  constructor(private readonly destinations: TelegramDestinationsService) {}

  /**
   * `GET /config/notifications/telegram` → the configured destinations
   * (name + chat id only).
   */
  @Get()
  @ApiOkResponse({ type: TelegramDestinationSummaryDto, isArray: true })
  list(): Promise<TelegramDestinationSummary[]> {
    return this.destinations.list();
  }

  /**
   * `POST /config/notifications/telegram` → upsert a destination by name.
   * Returns **200** with the non-sensitive summary (parity with the old API,
   * which returns 200 rather than 201 on this upsert).
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: TelegramDestinationSummaryDto })
  upsert(@Body() body: TelegramDestinationInputDto): Promise<TelegramDestinationSummary> {
    return this.destinations.upsert(body);
  }

  /**
   * `DELETE /config/notifications/telegram/:name` → remove a destination.
   * **204** on success; a 404 (via the global filter) when the name is unknown.
   */
  @Delete(':name')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  remove(@Param('name') name: string): Promise<void> {
    return this.destinations.remove(name);
  }
}
