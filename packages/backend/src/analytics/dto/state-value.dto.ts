import { StateValueType } from '@lametrader/core';
import { ApiProperty } from '@nestjs/swagger';

/**
 * One {@link import('@lametrader/core').StateValue}: a tagged scalar carrying its
 * `type` discriminant (`string` | `number` | `bool`, ADR-0013). Mirrors the old
 * TypeBox `StateValueSchema`.
 *
 * Documentation only — pins the OpenAPI contract; responses are not validated.
 */
export class StateValueDto {
  /**
   * The value's kind discriminant.
   */
  @ApiProperty({ enum: StateValueType, description: 'The value kind.' })
  type!: StateValueType;

  /**
   * The tagged value; a `string` when `type` is `string`, a `number` when
   * `number`, a `boolean` when `bool`.
   */
  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
    description: 'The value, whose shape matches `type`.',
  })
  value!: string | number | boolean;
}
