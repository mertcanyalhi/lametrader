import type { NotificationConfigSummary, NotificationConfigView } from '@lametrader/core';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { NotificationConfigDto } from '../dto/notification-config.dto.js';
import { CreateNotificationConfigDto } from '../dto/notification-config-input.dto.js';
import { NotificationConfigSummaryDto } from '../dto/notification-config-summary.dto.js';
import { UpdateNotificationConfigDto } from '../dto/notification-config-update.dto.js';
import { NotificationConfigsService } from '../services/notification-configs.service.js';

/**
 * The notification configurations, a sub-resource of `/config`.
 *
 * A generic, RESTful resource keyed by a stable `id`, carrying a
 * `notificationType` discriminator so more channels can be added later behind
 * one common shape (Telegram is the only channel today).
 *
 * - `GET  /config/notifications`     — list summaries (id + type + name).
 * - `POST /config/notifications`     — create (**201**); 409 on a duplicate name.
 * - `GET  /config/notifications/:id` — retrieve one view; 404 when unknown.
 * - `PATCH /config/notifications/:id`— partial update; 404 / 409; `notificationType` is immutable.
 * - `DELETE /config/notifications/:id`— remove (**204** / 404).
 *
 * Bot tokens are never read back; reads return the non-sensitive view/summary.
 */
@ApiTags('config')
@Controller('config/notifications')
export class NotificationsController {
  /**
   * @param configs - the notification-configs use-case to drive.
   */
  constructor(private readonly configs: NotificationConfigsService) {}

  /**
   * `GET /config/notifications` → the configured configs as list summaries.
   */
  @Get()
  @ApiOkResponse({ type: NotificationConfigSummaryDto, isArray: true })
  list(): Promise<NotificationConfigSummary[]> {
    return this.configs.list();
  }

  /**
   * `POST /config/notifications` → create a config. **201** with the view; a
   * duplicate name is a 409, invalid input a 400 (both via the global filter).
   */
  @Post()
  @ApiCreatedResponse({ type: NotificationConfigDto })
  create(@Body() body: CreateNotificationConfigDto): Promise<NotificationConfigView> {
    return this.configs.create(body);
  }

  /**
   * `GET /config/notifications/:id` → one config's view. 404 when unknown.
   */
  @Get(':id')
  @ApiOkResponse({ type: NotificationConfigDto })
  get(@Param('id') id: string): Promise<NotificationConfigView> {
    return this.configs.get(id);
  }

  /**
   * `PATCH /config/notifications/:id` → partial update. Returns **200** with
   * the view; 404 when unknown, 409 on a name collision. `notificationType` is
   * immutable — a body carrying it is rejected 400 by the validation pipe.
   */
  @Patch(':id')
  @ApiOkResponse({ type: NotificationConfigDto })
  update(
    @Param('id') id: string,
    @Body() body: UpdateNotificationConfigDto,
  ): Promise<NotificationConfigView> {
    return this.configs.update(id, body);
  }

  /**
   * `DELETE /config/notifications/:id` → remove a config. **204** on success;
   * a 404 (via the global filter) when the id is unknown.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  remove(@Param('id') id: string): Promise<void> {
    return this.configs.remove(id);
  }
}
