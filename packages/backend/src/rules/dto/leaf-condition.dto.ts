import {
  ChannelOperator,
  ComparisonOperator,
  CrossingOperator,
  LeafConditionFamily,
  MovingOperator,
  Period,
  StateOperator,
} from '@lametrader/core';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNumber, IsOptional, Min, ValidateNested } from 'class-validator';
import { ConditionOperandDto } from './condition-operand.dto.js';

/**
 * The merged set of every leaf operator — the flat-object leaf accepts any of
 * them on its `operator` key; the leaf's `family` discriminator dictates which
 * set the operator must come from at the engine layer. Mirrors the old TypeBox
 * `operatorEnum`.
 */
const LEAF_OPERATORS = {
  ...ComparisonOperator,
  ...CrossingOperator,
  ...ChannelOperator,
  ...MovingOperator,
  ...StateOperator,
} as const;

/**
 * One {@link import('@lametrader/core').LeafCondition} — mirrors the old TypeBox
 * `LeafConditionSchema`.
 *
 * Flat object with all family-specific keys optional; only `family`, `operator`,
 * and `left` are required. The engine dispatches by `family` and trusts the
 * schema (ADR-0016 #11).
 */
export class LeafConditionDto {
  /**
   * The leaf's operator family.
   */
  @ApiProperty({ enum: LeafConditionFamily })
  @IsEnum(LeafConditionFamily)
  family!: LeafConditionFamily;

  /**
   * The comparison / crossing / channel / moving / state operator.
   */
  @ApiProperty({ enum: LEAF_OPERATORS })
  @IsEnum(LEAF_OPERATORS)
  operator!: (typeof LEAF_OPERATORS)[keyof typeof LEAF_OPERATORS];

  /**
   * The left operand.
   */
  @ApiProperty({ type: ConditionOperandDto })
  @ValidateNested()
  @Type(() => ConditionOperandDto)
  left!: ConditionOperandDto;

  /**
   * Comparison / Crossing / State: the right operand.
   */
  @ApiPropertyOptional({ type: ConditionOperandDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ConditionOperandDto)
  right?: ConditionOperandDto;

  /**
   * Channel: the lower bound operand.
   */
  @ApiPropertyOptional({ type: ConditionOperandDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ConditionOperandDto)
  lower?: ConditionOperandDto;

  /**
   * Channel: the upper bound operand.
   */
  @ApiPropertyOptional({ type: ConditionOperandDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ConditionOperandDto)
  upper?: ConditionOperandDto;

  /**
   * Moving: the scalar threshold (absolute units or %).
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  threshold?: number;

  /**
   * Moving: the integer bar lookback.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  lookbackBars?: number;

  /**
   * OHLCV / Crossing / Channel / Moving / IndicatorRef leaves: bar period
   * disambiguator.
   */
  @ApiPropertyOptional({ enum: Period })
  @IsOptional()
  @IsEnum(Period)
  interval?: Period;
}
