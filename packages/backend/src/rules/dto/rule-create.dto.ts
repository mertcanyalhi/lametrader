import {
  type Action,
  type ConditionNode,
  type Expiration,
  RULE_DESCRIPTION_MAX,
  RULE_NAME_MAX,
  type RuleScope,
  type Trigger,
} from '@lametrader/core';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  ValidateIf,
} from 'class-validator';
import { ConditionNodeDto } from './condition-node.dto.js';
import { ExpirationDto } from './expiration.dto.js';
import { RuleActionDto } from './rule-action.dto.js';
import { RuleScopeDto } from './rule-scope.dto.js';
import { TriggerDto } from './trigger.dto.js';

/**
 * The `POST /rules` (create) request body — the client-controllable subset of a
 * {@link import('@lametrader/core').Rule}. Mirrors the old TypeBox
 * `RuleInputSchema` (the server generates `id`, `createdAt`, `updatedAt`).
 *
 * Boundary validation pins the field-level contract (correct scalar types /
 * lengths, non-empty `actions`, no unknown top-level properties). The nested
 * `scope` / `condition` / `trigger` / `actions` shapes are typed with the domain
 * types and documented for OpenAPI via {@link RuleScopeDto} / {@link ConditionNodeDto}
 * / {@link TriggerDto} / {@link RuleActionDto}; their semantic validation
 * (`validateRuleCondition`, tick-cadence eligibility, watched intervals) is the
 * domain's single trust boundary (ADR-0016 #11) and surfaces as its own 400 via
 * the exception filter.
 */
export class RuleCreateDto {
  /**
   * The parent profile's id.
   */
  @ApiProperty()
  @IsString()
  profileId!: string;

  /**
   * Human-readable name (non-empty).
   */
  @ApiProperty({ minLength: 1, maxLength: RULE_NAME_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(RULE_NAME_MAX)
  name!: string;

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
  @ApiProperty({ type: RuleScopeDto })
  @IsObject()
  scope!: RuleScope;

  /**
   * The condition tree evaluated each cadence tick.
   */
  @ApiProperty({ type: ConditionNodeDto })
  @IsObject()
  condition!: ConditionNode;

  /**
   * Which evaluation cadence drives the rule and how often it may re-fire.
   */
  @ApiProperty({ type: TriggerDto })
  @IsObject()
  trigger!: Trigger;

  /**
   * When the rule stops firing (`{ at }`) or `null` for never.
   */
  @ApiProperty({ type: ExpirationDto, nullable: true })
  @ValidateIf((o: RuleCreateDto) => o.expiration !== null)
  @IsObject()
  expiration!: Expiration;

  /**
   * Side-effects performed on fire (non-empty).
   */
  @ApiProperty({ type: RuleActionDto, isArray: true, minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  actions!: Action[];

  /**
   * Whether the rule is currently active.
   */
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  /**
   * Ordering hint within the parent profile.
   */
  @ApiProperty()
  @IsNumber()
  order!: number;
}
