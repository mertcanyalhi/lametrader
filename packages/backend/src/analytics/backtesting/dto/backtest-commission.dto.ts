import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional } from 'class-validator';

/**
 * The per-fill commission model on a run request: a `rate` (percent of each
 * fill's notional) and/or a flat `fixed` amount, both optional and combinable.
 *
 * Field-level validation only checks the types are numbers; the non-negative
 * business rule is enforced by the domain and surfaces as a `{ error }` 400.
 */
export class BacktestCommissionDto {
  /** Percent of each fill's notional (`0.1` = 0.1 %). */
  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @IsNumber()
  rate?: number;

  /** Flat amount charged per fill. */
  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @IsNumber()
  fixed?: number;
}
