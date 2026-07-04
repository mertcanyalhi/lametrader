import { SymbolType } from '@lametrader/core';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';

/**
 * Query for `GET /instruments` (discovery) — mirrors the old TypeBox
 * `DiscoverQuerySchema`.
 *
 * `q` is required free text; `type` optionally narrows discovery to one asset
 * class (fanned out to every source when omitted).
 */
export class DiscoverQueryDto {
  /**
   * Free-text search query (required).
   */
  @ApiProperty({ description: 'Free-text search query.' })
  @IsString()
  q!: string;

  /**
   * Optional asset-class filter; without it, every source is queried.
   */
  @ApiPropertyOptional({ enum: SymbolType, description: 'Narrow discovery to one asset class.' })
  @IsOptional()
  @IsEnum(SymbolType)
  type?: SymbolType;
}
