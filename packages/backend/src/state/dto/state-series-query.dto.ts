import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

/**
 * Query params for `GET /symbols/:id/state/:key/series` — mirrors the old TypeBox
 * `StateHistorySeriesQuerySchema`.
 *
 * `from` is inclusive, `to` is exclusive (epoch ms); omitting either means "no
 * bound on that side." Query values arrive as strings, so the numeric fields are
 * coerced before validation.
 */
export class StateSeriesQueryDto {
  /**
   * Inclusive lower bound on returned entries' `ts` (epoch ms).
   */
  @ApiPropertyOptional({
    type: Number,
    minimum: 0,
    description: 'Inclusive lower bound (epoch ms).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  from?: number;

  /**
   * Exclusive upper bound on returned entries' `ts` (epoch ms).
   */
  @ApiPropertyOptional({
    type: Number,
    minimum: 0,
    description: 'Exclusive upper bound (epoch ms).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  to?: number;
}
