import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/**
 * The path param carrying a backtest id, for the `/backtests/:id` routes.
 */
export class BacktestIdParamDto {
  /** The backtest id. */
  @ApiProperty({ description: 'Backtest id.' })
  @IsString()
  id!: string;
}
