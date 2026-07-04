import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/**
 * The path params carrying an indicator key, for `GET /indicators/:key` —
 * mirrors the old TypeBox `IndicatorKeyParamSchema`.
 */
export class IndicatorKeyParamDto {
  /**
   * The indicator definition key, e.g. `"sma"`.
   */
  @ApiProperty({ description: 'Indicator definition key (e.g. `sma`).' })
  @IsString()
  key!: string;
}
