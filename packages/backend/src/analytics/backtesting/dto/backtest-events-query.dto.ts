import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

/**
 * Query parameters for `GET /backtests/:id/events` — the same windowing shape as
 * the live rule-events window.
 *
 * `from` / `to` bound the entry's source `ts` (inclusive lower, exclusive
 * upper); `limit` caps the newest-first page (1..500; defaults to 50).
 */
export class BacktestEventsQueryDto {
  /** Inclusive lower bound on the entry's source `ts` (epoch ms). */
  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  from?: number;

  /** Exclusive upper bound on the entry's source `ts` (epoch ms). */
  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  to?: number;

  /** Max entries to return (1..500; the service defaults to 50). */
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
