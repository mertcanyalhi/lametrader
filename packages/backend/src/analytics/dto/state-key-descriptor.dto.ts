import { StateValueType } from '@lametrader/core';
import { ApiProperty } from '@nestjs/swagger';

/**
 * One known state-key for a symbol, returned by `GET /symbols/:id/state-keys` —
 * mirrors the old TypeBox `StateKeyDescriptorSchema`.
 *
 * Sourced from the rule-event log (`StateSet` entries on the watchlist document's
 * `events` array); `valueType` is the latest observed value's variant, so the
 * chart picks step-line vs marker rendering.
 *
 * Documentation only — pins the OpenAPI contract; responses are not validated.
 */
export class StateKeyDescriptorDto {
  /**
   * The state key written by the rule (e.g. `'last_signal'`).
   */
  @ApiProperty({ description: 'The state key.' })
  key!: string;

  /**
   * The value type observed most recently for this key.
   */
  @ApiProperty({ enum: StateValueType, description: 'The latest observed value type.' })
  valueType!: StateValueType;
}
