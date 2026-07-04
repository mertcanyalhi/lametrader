import { DEFAULT_CANDLE_LIMIT, MAX_CANDLE_LIMIT, Period } from '@lametrader/core';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

/**
 * Query for `GET /symbols/:id/candles` — mirrors the old TypeBox
 * `CandlesQuerySchema`.
 *
 * `period` is required; `from`/`to` are epoch ms (default the full stored range,
 * applied in the controller as `0` / `MAX_SAFE_INTEGER`); `limit` is the page
 * size (keyset-paginated by `time`), a positive integer defaulting to
 * {@link DEFAULT_CANDLE_LIMIT} and capped at {@link MAX_CANDLE_LIMIT} (over the
 * max → 400). Query values arrive as strings, so the numeric fields are coerced
 * before validation.
 */
export class CandlesQueryDto {
  /**
   * The period to read (one of the symbol's watched periods).
   */
  @ApiProperty({ enum: Period, description: 'The period to read.' })
  @IsEnum(Period)
  period!: Period;

  /**
   * Inclusive lower bound, epoch ms (defaults to the start of the stored range).
   */
  @ApiPropertyOptional({ type: Number, description: 'Inclusive lower bound (epoch ms).' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  from?: number;

  /**
   * Exclusive upper bound, epoch ms (defaults to the end of the stored range).
   */
  @ApiPropertyOptional({ type: Number, description: 'Exclusive upper bound (epoch ms).' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  to?: number;

  /**
   * Page size (keyset-paginated by `time`); positive integer, max
   * {@link MAX_CANDLE_LIMIT}, default {@link DEFAULT_CANDLE_LIMIT}.
   */
  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    maximum: MAX_CANDLE_LIMIT,
    default: DEFAULT_CANDLE_LIMIT,
    description: 'Page size (keyset-paginated by time).',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_CANDLE_LIMIT)
  limit: number = DEFAULT_CANDLE_LIMIT;
}
