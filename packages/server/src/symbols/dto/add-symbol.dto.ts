import { Period } from '@lametrader/core';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';

/**
 * The `POST /symbols` request body — mirrors the old TypeBox `AddSymbolSchema`.
 *
 * Boundary validation pins the field-level contract (an `id` string, and — when
 * present — each period a supported {@link Period}). The domain rules (existence
 * at the source, `periods ⊆ config.periods`, source capability) are enforced by
 * `SymbolService` and surface as `{ error }` 400 / 404 / 409.
 */
export class AddSymbolDto {
  /**
   * Canonical symbol id, e.g. `"crypto:BTCUSDT"`.
   */
  @ApiProperty({ description: 'Canonical symbol id (`<type>:<ticker>`).' })
  @IsString()
  id!: string;

  /**
   * Optional per-symbol periods; default to the config's periods.
   */
  @ApiPropertyOptional({ enum: Period, isArray: true, description: 'Per-symbol periods.' })
  @IsOptional()
  @IsArray()
  @IsEnum(Period, { each: true })
  periods?: Period[];
}
