import {
  type Action,
  type ConditionNode,
  type Expiration,
  RULE_DESCRIPTION_MAX,
  RULE_NAME_MAX,
  type RuleScope,
  type Trigger,
} from '@lametrader/core';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ConditionNodeDto } from './condition-node.dto.js';
import { ExpirationDto } from './expiration.dto.js';
import { RuleActionDto } from './rule-action.dto.js';
import { RuleScopeDto } from './rule-scope.dto.js';
import { TriggerDto } from './trigger.dto.js';

/**
 * The `PATCH /rules/:id` request body — every field optional (merge semantics).
 * Mirrors the old TypeBox `RulePatchSchema`; the engine re-validates the merged
 * rule against the same domain boundary (ADR-0016 #11).
 */
export class RulePatchDto {
  /**
   * The parent profile's id.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  profileId?: string;

  /**
   * Human-readable name (non-empty).
   */
  @ApiPropertyOptional({ minLength: 1, maxLength: RULE_NAME_MAX })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(RULE_NAME_MAX)
  name?: string;

  /**
   * Optional free-text description.
   */
  @ApiPropertyOptional({ maxLength: RULE_DESCRIPTION_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(RULE_DESCRIPTION_MAX)
  description?: string;

  /**
   * Which symbol(s) the rule applies to.
   */
  @ApiPropertyOptional({ type: RuleScopeDto })
  @IsOptional()
  @IsObject()
  scope?: RuleScope;

  /**
   * The condition tree evaluated each cadence tick.
   */
  @ApiPropertyOptional({ type: ConditionNodeDto })
  @IsOptional()
  @IsObject()
  condition?: ConditionNode;

  /**
   * Which evaluation cadence drives the rule and how often it may re-fire.
   */
  @ApiPropertyOptional({ type: TriggerDto })
  @IsOptional()
  @IsObject()
  trigger?: Trigger;

  /**
   * When the rule stops firing (`{ at }`) or `null` for never.
   */
  @ApiPropertyOptional({ type: ExpirationDto, nullable: true })
  @IsOptional()
  expiration?: Expiration;

  /**
   * Side-effects performed on fire (non-empty).
   */
  @ApiPropertyOptional({ type: RuleActionDto, isArray: true, minItems: 1 })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  actions?: Action[];

  /**
   * Whether the rule is currently active.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /**
   * Ordering hint within the parent profile.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  order?: number;
}
