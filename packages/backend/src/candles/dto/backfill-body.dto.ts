import { Period } from '@lametrader/core';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional } from 'class-validator';

/**
 * Body for `POST /symbols/:id/backfill` — mirrors the old TypeBox
 * `BackfillBodySchema`.
 *
 * `period` is required; `from`/`to` are epoch ms and omitting both backfills the
 * provider's deepest history. The DTO pins the field-level shape; the cross-field
 * range rule (`from < to`, finite bounds) is enforced in the controller via the
 * domain's `parseBackfillRange`, surfacing as a `CandleError` → 400.
 */
export class BackfillBodyDto {
  /**
   * The period to backfill (one of the symbol's watched periods).
   */
  @ApiProperty({ enum: Period, description: 'The period to backfill.' })
  @IsEnum(Period)
  period!: Period;

  /**
   * Inclusive lower bound, epoch ms (omit with `to` for deepest history).
   */
  @ApiPropertyOptional({ type: Number, description: 'Inclusive lower bound (epoch ms).' })
  @IsOptional()
  @IsNumber()
  from?: number;

  /**
   * Exclusive upper bound, epoch ms (omit with `from` for deepest history).
   */
  @ApiPropertyOptional({ type: Number, description: 'Exclusive upper bound (epoch ms).' })
  @IsOptional()
  @IsNumber()
  to?: number;
}
