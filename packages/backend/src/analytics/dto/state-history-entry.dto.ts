import { ApiProperty } from '@nestjs/swagger';
import { StateValueDto } from './state-value.dto.js';

/**
 * One sample on a state key's time-series, returned by
 * `GET /symbols/:id/state/:key/series` — mirrors the old TypeBox
 * `StateHistoryEntrySchema`.
 *
 * `value === null` marks a removal (`StateRemoved` event); a present value is the
 * new value at `ts` (`StateSet` event).
 *
 * Documentation only — pins the OpenAPI contract; responses are not validated.
 */
export class StateHistoryEntryDto {
  /**
   * Source timestamp from the originating rule event (epoch ms).
   */
  @ApiProperty({ description: 'Source timestamp (epoch ms).' })
  ts!: number;

  /**
   * The new value at `ts`, or `null` when the key was removed at `ts`.
   */
  @ApiProperty({
    type: StateValueDto,
    nullable: true,
    description: 'The value at `ts`, or `null` on a removal.',
  })
  value!: StateValueDto | null;
}
