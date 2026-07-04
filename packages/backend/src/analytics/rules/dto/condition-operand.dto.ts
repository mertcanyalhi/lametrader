import { OperandKind, STATE_KEY_MAX, StateValueType } from '@lametrader/core';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { StateValueDto } from './state-value.dto.js';

/**
 * One {@link import('@lametrader/core').ConditionOperand} — mirrors the old
 * TypeBox `ConditionOperandSchema`.
 *
 * Modeled as a flat object with all variant keys optional: only `kind` is
 * required; the engine trusts the schema and ignores absent slots (ADR-0016 #11).
 */
export class ConditionOperandDto {
  /**
   * The operand kind discriminant.
   */
  @ApiPropertyOptional({ enum: OperandKind })
  @IsEnum(OperandKind)
  kind!: OperandKind;

  /**
   * Literal: the constant tagged value.
   */
  @ApiPropertyOptional({ type: StateValueDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => StateValueDto)
  value?: StateValueDto;

  /**
   * IndicatorRef: the profile-attached indicator instance id.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  instanceId?: string;

  /**
   * IndicatorRef: the state-field key on that instance.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(STATE_KEY_MAX)
  stateKey?: string;

  /**
   * SymbolStateRef / GlobalStateRef: the state-map key.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(STATE_KEY_MAX)
  key?: string;

  /**
   * IndicatorRef / SymbolStateRef / GlobalStateRef: the value type the ref
   * resolves to.
   */
  @ApiPropertyOptional({ enum: StateValueType })
  @IsOptional()
  @IsEnum(StateValueType)
  valueType?: StateValueType;
}
