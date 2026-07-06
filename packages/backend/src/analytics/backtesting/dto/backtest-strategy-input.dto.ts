import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, ValidateNested } from 'class-validator';
import { BacktestStrategyEntryDto } from './backtest-strategy-entry.dto.js';
import { BacktestStrategyExitDto } from './backtest-strategy-exit.dto.js';

/**
 * The `POST /backtest-strategies` (create) and `PUT /backtest-strategies/:id`
 * (replace) request body.
 *
 * Only `name` is required at the field level; `entry` and `exit` are validated
 * when present. The two business rules — an entry signal is required and the exit
 * must set at least one mechanism — are enforced by the domain
 * (`parseBacktestStrategyFields`) and surface as `{ error }` 400 / 409, mirroring
 * how the profiles resource splits boundary validation from domain rules.
 */
export class BacktestStrategyInputDto {
  /**
   * Human-readable, unique name.
   */
  @ApiProperty({ description: 'Human-readable, unique name.' })
  @IsString()
  name!: string;

  /**
   * Free-text description; defaults to `''` in the domain.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  /**
   * The entry definition (required by the domain).
   */
  @ApiPropertyOptional({ type: BacktestStrategyEntryDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BacktestStrategyEntryDto)
  entry?: BacktestStrategyEntryDto;

  /**
   * The exit definition (at least one mechanism required by the domain).
   */
  @ApiPropertyOptional({ type: BacktestStrategyExitDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BacktestStrategyExitDto)
  exit?: BacktestStrategyExitDto;
}
