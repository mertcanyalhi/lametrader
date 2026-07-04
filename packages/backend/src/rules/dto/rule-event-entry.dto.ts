import { RuleEventType, StateScope } from '@lametrader/core';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StateValueDto } from './state-value.dto.js';

/**
 * One entry in a rule's mirrored events log — a tagged union over
 * {@link RuleEventType}. Mirrors the old TypeBox `RuleEventEntrySchema`, flattened
 * with per-variant fields optional.
 *
 * Documentation only — pins the OpenAPI contract; responses are the domain
 * entries serialized as-is.
 */
export class RuleEventEntryDto {
  /** The event type discriminant. */
  @ApiProperty({ enum: RuleEventType })
  type!: RuleEventType;

  /** The source `ts` that drove evaluation (epoch ms). */
  @ApiProperty()
  ts!: number;

  /** The wall-clock persistence stamp (epoch ms). */
  @ApiPropertyOptional()
  firedAt?: number;

  /** The owning rule id (empty for orchestrator-level entries). */
  @ApiProperty()
  ruleId!: string;

  /** The affected symbol id. */
  @ApiProperty()
  symbolId!: string;

  /** Fired: the inbound event + the firing symbol's OHLCV snapshot. */
  @ApiPropertyOptional({ type: Object })
  context?: unknown;

  /** CycleOverflow: the breached limit. */
  @ApiPropertyOptional()
  cycleLimit?: number;

  /** StateSet / StateRemoved: the affected scope. */
  @ApiPropertyOptional({ enum: StateScope })
  scope?: StateScope;

  /** StateSet / StateRemoved: the affected key. */
  @ApiPropertyOptional()
  key?: string;

  /** StateSet: the value written. */
  @ApiPropertyOptional({ type: StateValueDto })
  value?: StateValueDto;

  /** NotificationSent: the destination name. */
  @ApiPropertyOptional()
  destinationName?: string;

  /** NotificationSent: the rendered body. */
  @ApiPropertyOptional()
  body?: string;

  /** Error: the human-readable reason. */
  @ApiPropertyOptional()
  reason?: string;
}
