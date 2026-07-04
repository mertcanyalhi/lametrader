import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ConditionNodeDto } from './condition-node.dto.js';
import { ExpirationDto } from './expiration.dto.js';
import { RuleActionDto } from './rule-action.dto.js';
import { RuleScopeDto } from './rule-scope.dto.js';
import { TriggerDto } from './trigger.dto.js';

/**
 * A full {@link import('@lametrader/core').Rule} — the 200/201 response shape on
 * every `/rules` route. Mirrors the old TypeBox `RuleSchema`.
 *
 * Documentation only — pins the OpenAPI contract; responses are the domain rule
 * serialized as-is (there are no non-response fields to strip, so no
 * serializer interceptor is needed).
 */
export class RuleDto {
  /** Generated, stable id. */
  @ApiProperty()
  id!: string;

  /** The parent profile's id. */
  @ApiProperty()
  profileId!: string;

  /** Human-readable name. */
  @ApiProperty()
  name!: string;

  /** Optional free-text description. */
  @ApiPropertyOptional()
  description?: string;

  /** Which symbol(s) the rule applies to. */
  @ApiProperty({ type: RuleScopeDto })
  scope!: RuleScopeDto;

  /** The condition tree evaluated each cadence tick. */
  @ApiProperty({ type: ConditionNodeDto })
  condition!: ConditionNodeDto;

  /** Which evaluation cadence drives the rule and how often it may re-fire. */
  @ApiProperty({ type: TriggerDto })
  trigger!: TriggerDto;

  /** When the rule stops firing (`{ at }`) or `null` for never. */
  @ApiProperty({ type: ExpirationDto, nullable: true })
  expiration!: ExpirationDto | null;

  /** Side-effects performed on fire. */
  @ApiProperty({ type: RuleActionDto, isArray: true })
  actions!: RuleActionDto[];

  /** Whether the rule is currently active. */
  @ApiProperty()
  enabled!: boolean;

  /** Ordering hint within the parent profile. */
  @ApiProperty()
  order!: number;

  /** Creation time (epoch ms). */
  @ApiProperty()
  createdAt!: number;

  /** Last-update time (epoch ms). */
  @ApiProperty()
  updatedAt!: number;

  /** Last time the orchestrator fired this rule (epoch ms); absent until first fire. */
  @ApiPropertyOptional()
  lastFiredAt?: number;
}
