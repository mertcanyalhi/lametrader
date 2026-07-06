import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import { BacktestSignalDto } from './backtest-signal.dto.js';

/**
 * A strategy's entry definition — the required entry {@link BacktestSignalDto}.
 *
 * The `signal` field is required by the domain (v1); it is an object rather than a
 * bare signal so multi-condition entries can be added later without a shape change.
 */
export class BacktestStrategyEntryDto {
  /**
   * The transition that opens a position while flat.
   */
  @ApiProperty({ type: BacktestSignalDto })
  @ValidateNested()
  @Type(() => BacktestSignalDto)
  signal!: BacktestSignalDto;
}
