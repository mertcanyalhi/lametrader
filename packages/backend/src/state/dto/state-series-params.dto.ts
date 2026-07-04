import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/**
 * Path params for `GET /symbols/:id/state/:key/series` — mirrors the old TypeBox
 * `StateHistorySeriesParamsSchema`.
 */
export class StateSeriesParamsDto {
  /**
   * Canonical symbol id, e.g. `"crypto:BTCUSDT"`.
   */
  @ApiProperty({ description: 'Canonical symbol id (`<type>:<ticker>`).' })
  @IsString()
  id!: string;

  /**
   * The state key whose time-series to read.
   */
  @ApiProperty({ description: 'The state key whose time-series to read.' })
  @IsString()
  key!: string;
}
