import { ApiProperty } from '@nestjs/swagger';

/**
 * Per-chunk backfill progress — a job's `progress` once the first chunk lands.
 * Mirrors the old TypeBox `BackfillProgressSchema`.
 *
 * Documentation only — pins the OpenAPI contract; responses are not validated.
 */
export class BackfillProgressDto {
  /** Candles persisted so far. */
  @ApiProperty()
  saved!: number;

  /** Total candles fetched for this backfill. */
  @ApiProperty()
  total!: number;
}
