import { Period, TriggerKind } from '@lametrader/core';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';

/**
 * One {@link import('@lametrader/core').Trigger} — mirrors the old TypeBox
 * `TriggerSchema`.
 *
 * Flat object with `period` / `intervalMs` optional (required per-kind by the
 * engine, allowed empty by the boundary for `EveryTime` / `Once`).
 */
export class TriggerDto {
  /**
   * The trigger kind (one of the six cadences).
   */
  @ApiProperty({ enum: TriggerKind })
  @IsEnum(TriggerKind)
  kind!: TriggerKind;

  /**
   * The bar period, for bar-cadence triggers.
   */
  @ApiPropertyOptional({ enum: Period })
  @IsOptional()
  @IsEnum(Period)
  period?: Period;

  /**
   * The wall-clock interval in ms, for `OncePerInterval`.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  intervalMs?: number;
}
