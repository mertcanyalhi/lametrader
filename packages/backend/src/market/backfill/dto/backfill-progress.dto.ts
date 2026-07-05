import { BackfillPhase } from '@lametrader/core';
import { ApiProperty } from '@nestjs/swagger';

/**
 * A backfill progress frame — a job's `progress` once the first frame lands.
 * Reported across both phases: retrieval (`phase: fetching`, `total` estimated)
 * then persistence (`phase: saving`, `total` = actual fetched count).
 *
 * Documentation only — pins the OpenAPI contract; responses are not validated.
 */
export class BackfillProgressDto {
  /** Which phase this frame describes. */
  @ApiProperty({ enum: BackfillPhase, enumName: 'BackfillPhase' })
  phase!: BackfillPhase;

  /** Candles retrieved (fetching) or persisted (saving) so far. */
  @ApiProperty()
  done!: number;

  /** Estimated total (fetching) or actual fetched count (saving). */
  @ApiProperty()
  total!: number;
}
