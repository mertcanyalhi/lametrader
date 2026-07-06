import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, ValidateNested } from 'class-validator';
import { BacktestSignalDto } from './backtest-signal.dto.js';
import { BacktestThresholdDto } from './backtest-threshold.dto.js';

/**
 * A strategy's exit definition — every mechanism is optional at the boundary; the
 * domain (`parseBacktestStrategyFields`) requires **at least one** and surfaces a
 * violation as a `{ error }` 400.
 */
export class BacktestStrategyExitDto {
  /**
   * A transition that closes the position at the producing candle's close.
   */
  @ApiPropertyOptional({ type: BacktestSignalDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BacktestSignalDto)
  signal?: BacktestSignalDto;

  /**
   * A profit-target level, entry-relative per its kind.
   */
  @ApiPropertyOptional({ type: BacktestThresholdDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BacktestThresholdDto)
  profitTarget?: BacktestThresholdDto;

  /**
   * A stop-loss level, entry-relative per its kind.
   */
  @ApiPropertyOptional({ type: BacktestThresholdDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BacktestThresholdDto)
  stopLoss?: BacktestThresholdDto;
}
