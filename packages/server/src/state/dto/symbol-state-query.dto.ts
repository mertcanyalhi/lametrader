import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/**
 * The required `?profileId=...` query for `GET /symbols/:id/state` — mirrors the
 * old TypeBox `SymbolStateQuerySchema`.
 *
 * State is partitioned by profile (#281), so the caller has to name one; an
 * absent `profileId` fails validation as a 400.
 */
export class SymbolStateQueryDto {
  /**
   * The profile whose state map for this symbol to read.
   */
  @ApiProperty({ description: 'Profile id whose state map to read.' })
  @IsString()
  profileId!: string;
}
