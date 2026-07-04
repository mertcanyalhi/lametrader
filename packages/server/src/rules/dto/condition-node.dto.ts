import { ConditionNodeKind } from '@lametrader/core';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsOptional, ValidateNested } from 'class-validator';
import { LeafConditionDto } from './leaf-condition.dto.js';

/**
 * One node of a rule's condition tree — mirrors the old TypeBox
 * `ConditionNodeSchema`, recursive via `children` for And/Or.
 *
 * Only `kind` is required; `children` (And/Or) and `leaf` (Leaf) are the
 * variant slots. The engine dispatches by `kind` and trusts the schema
 * (ADR-0016 #11).
 */
export class ConditionNodeDto {
  /**
   * The node kind (And / Or / Leaf).
   */
  @ApiPropertyOptional({ enum: ConditionNodeKind })
  @IsEnum(ConditionNodeKind)
  kind!: ConditionNodeKind;

  /**
   * And / Or: the nested child nodes.
   */
  @ApiPropertyOptional({ type: () => ConditionNodeDto, isArray: true })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConditionNodeDto)
  children?: ConditionNodeDto[];

  /**
   * Leaf: the embedded leaf condition.
   */
  @ApiPropertyOptional({ type: LeafConditionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LeafConditionDto)
  leaf?: LeafConditionDto;
}
