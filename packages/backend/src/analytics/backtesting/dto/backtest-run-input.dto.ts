import { Period } from '@lametrader/core';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { BacktestCommissionDto } from './backtest-commission.dto.js';

/**
 * The `POST /backtests` request body — a run request.
 *
 * Field-level validation pins the types (ids are strings, `period` is a known
 * {@link Period}, the window bounds and capital are numbers, the commission is a
 * well-formed object). The business rules — `start < end`, `end ≤ now`,
 * `initialCapital > 0`, non-negative commissions, a complete strategy, an
 * enabled + in-scope profile, and at least one stored candle in range — are
 * enforced by the domain / run service and surface as `{ error }` 400, mirroring
 * how the other resources split boundary validation from domain rules.
 */
export class BacktestRunInputDto {
  /** The source strategy id (snapshotted at run time). */
  @ApiProperty({ description: 'Backtest strategy id.' })
  @IsString()
  strategyId!: string;

  /** The watched symbol to replay. */
  @ApiProperty({ description: 'Watched symbol id.' })
  @IsString()
  symbolId!: string;

  /** The profile whose rules drive the run. */
  @ApiProperty({ description: 'Profile id.' })
  @IsString()
  profileId!: string;

  /** The chart period the run is anchored to. */
  @ApiProperty({ enum: Period })
  @IsEnum(Period)
  period!: Period;

  /** Replay window start, epoch milliseconds (inclusive). */
  @ApiProperty({ type: Number })
  @IsNumber()
  start!: number;

  /** Replay window end, epoch milliseconds (exclusive). */
  @ApiProperty({ type: Number })
  @IsNumber()
  end!: number;

  /** Starting equity. */
  @ApiProperty({ type: Number })
  @IsNumber()
  initialCapital!: number;

  /** The per-fill commission model (defaults to none when omitted). */
  @ApiPropertyOptional({ type: BacktestCommissionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BacktestCommissionDto)
  commission?: BacktestCommissionDto;
}
