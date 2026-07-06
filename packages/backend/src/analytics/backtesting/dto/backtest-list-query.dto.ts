import { BacktestStatus } from '@lametrader/core';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

/**
 * Query parameters for `GET /backtests` — an optional `status` filter over the
 * merged running + persisted list.
 */
export class BacktestListQueryDto {
  /** Keep only backtests in this lifecycle status. */
  @ApiPropertyOptional({ enum: BacktestStatus })
  @IsOptional()
  @IsEnum(BacktestStatus)
  status?: BacktestStatus;
}
