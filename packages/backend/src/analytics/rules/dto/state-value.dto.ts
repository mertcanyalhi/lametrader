import { StateValueType } from '@lametrader/core';
import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsEnum } from 'class-validator';

/**
 * One {@link import('@lametrader/core').StateValue}: a tagged scalar carrying its
 * `type` discriminant (`string` | `number` | `bool`, ADR-0013). Mirrors the old
 * TypeBox `StateValueSchema`.
 *
 * The `type` enum is pinned; `value`'s scalar shape is trusted per the tagged
 * type (ADR-0016 #11 — the engine trusts the boundary and the round-trip test
 * proves the pairing).
 */
export class StateValueDto {
  /**
   * The value's kind discriminant.
   */
  @ApiProperty({ enum: StateValueType, description: 'The value kind.' })
  @IsEnum(StateValueType)
  type!: StateValueType;

  /**
   * The tagged value; a `string` when `type` is `string`, a `number` when
   * `number`, a `boolean` when `bool`.
   */
  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
    description: 'The value, whose shape matches `type`.',
  })
  @IsDefined()
  value!: string | number | boolean;
}
