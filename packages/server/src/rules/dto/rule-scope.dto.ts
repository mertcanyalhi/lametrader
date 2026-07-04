import { RuleScopeKind, SYMBOL_ID_MAX } from '@lametrader/core';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * A {@link import('@lametrader/core').RuleScope} — mirrors the old TypeBox
 * `RuleScopeSchema`.
 *
 * Flat object: `Symbol` carries `symbolId`, `Symbols` carries `symbolIds`,
 * `AllSymbols` carries neither. Only `kind` is required.
 */
export class RuleScopeDto {
  /**
   * The scope kind discriminant.
   */
  @ApiProperty({ enum: RuleScopeKind })
  @IsEnum(RuleScopeKind)
  kind!: RuleScopeKind;

  /**
   * Symbol: the single watched symbol id.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(SYMBOL_ID_MAX)
  symbolId?: string;

  /**
   * Symbols: the explicit list of watched symbol ids.
   */
  @ApiPropertyOptional({ type: String, isArray: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(SYMBOL_ID_MAX, { each: true })
  symbolIds?: string[];
}
