import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

/**
 * Query parameters for the event-log read endpoints — mirrors the old TypeBox
 * `RuleEventsQuerySchema`.
 *
 * `from` / `to` bound the entry's source `ts` (inclusive lower, exclusive upper)
 * and back the chart's visible-window read; `before` is the older "next page"
 * cursor and ANDs with the window.
 */
export class RuleEventsQueryDto {
  /**
   * Max entries to return (1..500; the service defaults to 50).
   */
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  /**
   * Return only entries with `ts < before` (epoch-ms cursor for "next page").
   */
  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  before?: number;

  /**
   * Inclusive lower bound on the entry's source `ts` (epoch ms).
   */
  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  from?: number;

  /**
   * Exclusive upper bound on the entry's source `ts` (epoch ms).
   */
  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  to?: number;
}
