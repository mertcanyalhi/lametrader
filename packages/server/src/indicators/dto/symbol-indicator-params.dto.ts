import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/**
 * The path params for the symbol-scoped compute route,
 * `GET /symbols/:id/indicators/:key` — mirrors the old TypeBox
 * `SymbolIndicatorParamsSchema`.
 */
export class SymbolIndicatorParamsDto {
  /**
   * Canonical symbol id, e.g. `"crypto:BTCUSDT"`.
   */
  @ApiProperty({ description: 'Canonical symbol id (`<type>:<ticker>`).' })
  @IsString()
  id!: string;

  /**
   * The indicator definition key, e.g. `"sma"`.
   */
  @ApiProperty({ description: 'Indicator definition key (e.g. `sma`).' })
  @IsString()
  key!: string;
}
