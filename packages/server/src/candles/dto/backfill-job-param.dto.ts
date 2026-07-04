import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/**
 * Path params for `GET /symbols/:id/backfill/jobs/:jobId` — the symbol id and the
 * job id (mirrors the old TypeBox `BackfillJobParamSchema`).
 */
export class BackfillJobParamDto {
  /**
   * Canonical symbol id, e.g. `"crypto:BTCUSDT"`.
   */
  @ApiProperty({ description: 'Canonical symbol id (`<type>:<ticker>`).' })
  @IsString()
  id!: string;

  /**
   * The backfill job id (from the 202 response).
   */
  @ApiProperty({ description: 'The backfill job id.' })
  @IsString()
  jobId!: string;
}
