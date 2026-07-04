import { Period } from '@lametrader/core';
import { ApiProperty } from '@nestjs/swagger';

/**
 * The outcome of a completed backfill — carried on a job's `summary` once it
 * succeeds. `from`/`to` are the first/last persisted candle time (or `null` when
 * nothing was fetched); `complete` is `false` when the provider capped the fetch
 * and more history may exist. Mirrors the old TypeBox `BackfillSummarySchema`.
 *
 * Documentation only — pins the OpenAPI contract; responses are not validated.
 */
export class BackfillSummaryDto {
  /** Canonical symbol id backfilled. */
  @ApiProperty()
  id!: string;

  /** Period backfilled. */
  @ApiProperty({ enum: Period })
  period!: Period;

  /** First persisted candle `time` (epoch ms), or `null`. */
  @ApiProperty({ type: Number, nullable: true })
  from!: number | null;

  /** Last persisted candle `time` (epoch ms), or `null`. */
  @ApiProperty({ type: Number, nullable: true })
  to!: number | null;

  /** Number of candles fetched from the source. */
  @ApiProperty()
  fetched!: number;

  /** Number of candles persisted. */
  @ApiProperty()
  saved!: number;

  /** `false` when the fetch was capped and more history may exist. */
  @ApiProperty()
  complete!: boolean;
}
