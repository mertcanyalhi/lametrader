import { Period } from '@lametrader/core';
import { ApiProperty } from '@nestjs/swagger';
import { BackfillJobStatus } from '../backfill-job.types.js';
import { BackfillProgressDto } from './backfill-progress.dto.js';
import { BackfillSummaryDto } from './backfill-summary.dto.js';

/**
 * An asynchronous backfill job resource — the `202` response of
 * `POST /symbols/:id/backfill`, the `200` of `GET …/jobs/:jobId`, and each frame
 * of the per-job progress WebSocket. Mirrors the old TypeBox `BackfillJobSchema`.
 *
 * Documentation only — pins the OpenAPI contract; responses are not validated.
 */
export class BackfillJobDto {
  /** Opaque job id. */
  @ApiProperty()
  id!: string;

  /** Canonical symbol id being backfilled. */
  @ApiProperty()
  symbolId!: string;

  /** Period being backfilled. */
  @ApiProperty({ enum: Period })
  period!: Period;

  /** Lifecycle state. */
  @ApiProperty({ enum: BackfillJobStatus })
  status!: BackfillJobStatus;

  /** Latest progress, or `null` before the first persisted chunk. */
  @ApiProperty({ type: BackfillProgressDto, nullable: true })
  progress!: BackfillProgressDto | null;

  /** The summary once `succeeded`, else `null`. */
  @ApiProperty({ type: BackfillSummaryDto, nullable: true })
  summary!: BackfillSummaryDto | null;

  /** The failure message once `failed`, else `null`. */
  @ApiProperty({ type: String, nullable: true })
  error!: string | null;
}
