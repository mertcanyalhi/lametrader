import { Period } from '@lametrader/core';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEnum, IsOptional } from 'class-validator';

/**
 * A partial configuration — the `PATCH /config` request body.
 *
 * Every field is optional; omitted fields are taken from the current config by
 * the domain's merge. Present fields carry the same field-level validation as
 * {@link ConfigDto}; the merged result's cross-field validity is enforced by
 * the domain.
 */
export class ConfigPatchDto {
  /**
   * Replacement periods, when changing them.
   */
  @ApiPropertyOptional({ enum: Period, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(Period, { each: true })
  periods?: Period[];

  /**
   * Replacement default period, when changing it.
   */
  @ApiPropertyOptional({ enum: Period })
  @IsOptional()
  @IsEnum(Period)
  defaultPeriod?: Period;
}
