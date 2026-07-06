import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsString, ValidateNested } from 'class-validator';
import { StateValueDto } from '../../rules/dto/state-value.dto.js';

/**
 * An edge-triggered signal — a symbol-scoped state `key` and the tagged `value`
 * it must change to. Reuses the validated rules {@link StateValueDto}; `value.type`
 * doubles as the key's declared value type.
 *
 * Field-level validation pins the shape; the domain (`parseBacktestStrategyFields`)
 * enforces the value/type pairing and surfaces mismatches as a `{ error }` 400.
 */
export class BacktestSignalDto {
  /**
   * The symbol-scoped state key the signal watches.
   */
  @ApiProperty({ description: 'Symbol-scoped state key.' })
  @IsString()
  key!: string;

  /**
   * The tagged value the key must change to for the signal to fire.
   */
  @ApiProperty({ type: StateValueDto })
  @ValidateNested()
  @Type(() => StateValueDto)
  value!: StateValueDto;
}
