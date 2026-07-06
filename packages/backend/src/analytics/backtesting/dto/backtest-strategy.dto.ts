import { ApiProperty } from '@nestjs/swagger';
import { BacktestStrategyEntryDto } from './backtest-strategy-entry.dto.js';
import { BacktestStrategyExitDto } from './backtest-strategy-exit.dto.js';

/**
 * The `200`/`201` response shape of a full backtest strategy.
 *
 * Documentation only — pins the OpenAPI contract; responses are not validated.
 */
export class BacktestStrategyDto {
  /** Generated, stable id. */
  @ApiProperty()
  id!: string;

  /** Human-readable, unique name. */
  @ApiProperty()
  name!: string;

  /** Free-text description. */
  @ApiProperty()
  description!: string;

  /** The entry definition. */
  @ApiProperty({ type: BacktestStrategyEntryDto })
  entry!: BacktestStrategyEntryDto;

  /** The exit definition (at least one mechanism). */
  @ApiProperty({ type: BacktestStrategyExitDto })
  exit!: BacktestStrategyExitDto;

  /** Creation time, epoch milliseconds. */
  @ApiProperty()
  createdAt!: number;

  /** Last-update time, epoch milliseconds. */
  @ApiProperty()
  updatedAt!: number;
}
