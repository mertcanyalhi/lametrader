import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Query for `GET /symbols` — mirrors the old TypeBox `ListSymbolsQuerySchema`.
 *
 * With `enrich=true` each listed symbol carries a computed `quote`; absent or any
 * other value returns the plain watchlist (the same truthiness the old handler
 * used). The string query value is coerced to a boolean before validation.
 */
export class ListSymbolsQueryDto {
  /**
   * When `true`, attach a `quote` to each symbol.
   */
  @ApiPropertyOptional({
    type: Boolean,
    description: 'Attach a computed quote per symbol.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  enrich?: boolean;
}
