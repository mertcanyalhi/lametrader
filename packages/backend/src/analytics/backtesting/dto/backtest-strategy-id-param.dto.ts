import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/**
 * The path params carrying a strategy id, for the `/backtest-strategies/:id`
 * routes.
 */
export class BacktestStrategyIdParamDto {
  /**
   * The backtest strategy id.
   */
  @ApiProperty({ description: 'Backtest strategy id.' })
  @IsString()
  id!: string;
}
