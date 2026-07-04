import {
  ActionKind,
  DESTINATION_NAME_MAX,
  NotificationChannel,
  STATE_KEY_MAX,
  TELEGRAM_TEMPLATE_MAX,
} from '@lametrader/core';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { StateValueDto } from './state-value.dto.js';

/**
 * One {@link import('@lametrader/core').Action} — mirrors the old TypeBox
 * `ActionSchema`.
 *
 * Flat object with all variant keys optional; only `kind` is required. The engine
 * dispatches by `kind` and trusts the schema (ADR-0016 #11).
 */
export class RuleActionDto {
  /**
   * The action kind discriminant.
   */
  @ApiProperty({ enum: ActionKind })
  @IsEnum(ActionKind)
  kind!: ActionKind;

  /**
   * Notification: the channel discriminator (only Telegram at launch).
   */
  @ApiPropertyOptional({ enum: NotificationChannel })
  @IsOptional()
  @IsEnum(NotificationChannel)
  channel?: NotificationChannel;

  /**
   * Notification: the destination name.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(DESTINATION_NAME_MAX)
  destinationName?: string;

  /**
   * Notification: the message template.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(TELEGRAM_TEMPLATE_MAX)
  template?: string;

  /**
   * State actions: the affected key.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(STATE_KEY_MAX)
  key?: string;

  /**
   * SetSymbolState / SetGlobalState: the value written.
   */
  @ApiPropertyOptional({ type: StateValueDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => StateValueDto)
  value?: StateValueDto;
}
