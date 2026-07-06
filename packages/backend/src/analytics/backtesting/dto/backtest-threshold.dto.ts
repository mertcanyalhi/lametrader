import { BacktestThresholdKind } from '@lametrader/core';
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNumber } from 'class-validator';

/**
 * A profit-target or stop-loss threshold — a `kind` (`fixed` | `percentage`) and
 * an `amount`.
 *
 * Field-level validation pins `kind` to a {@link BacktestThresholdKind} value and
 * `amount` to a number; the domain enforces `amount > 0` and surfaces a
 * violation as a `{ error }` 400.
 */
export class BacktestThresholdDto {
  /**
   * Whether `amount` is an absolute price offset (`fixed`) or a percent of the
   * entry price (`percentage`).
   */
  @ApiProperty({ enum: BacktestThresholdKind, description: 'Threshold kind.' })
  @IsEnum(BacktestThresholdKind)
  kind!: BacktestThresholdKind;

  /**
   * The threshold magnitude (a price offset, or a percentage number).
   */
  @ApiProperty({ description: 'Threshold magnitude (price offset or percentage number).' })
  @IsNumber()
  amount!: number;
}
