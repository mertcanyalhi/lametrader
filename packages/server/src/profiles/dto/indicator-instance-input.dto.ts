import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString } from 'class-validator';

/**
 * The body for `POST /profiles/:id/indicators` (attach) and
 * `PUT /profiles/:id/indicators/:instanceId` (replace) — mirrors the old TypeBox
 * `IndicatorInstanceInputSchema`.
 *
 * `inputs` is opaque at the boundary (a `Record<string, unknown>`); each
 * indicator has its own descriptor schema, so `ProfileService` validates `inputs`
 * against `IndicatorRegistry.get(indicatorKey).definition` and surfaces an
 * `IndicatorError` → 400 for an unknown key or invalid values.
 */
export class IndicatorInstanceInputDto {
  /**
   * Which indicator definition (key) from the catalog to attach.
   */
  @ApiProperty({ description: 'Indicator definition key, e.g. `"sma"`.' })
  @IsString()
  indicatorKey!: string;

  /**
   * Raw input values, validated + defaulted by the domain against the definition.
   */
  @ApiPropertyOptional({ type: Object, description: 'Raw indicator input values.' })
  @IsOptional()
  @IsObject()
  inputs?: Record<string, unknown>;

  /**
   * Optional alias to tell two attachments of the same indicator apart.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  label?: string;
}
