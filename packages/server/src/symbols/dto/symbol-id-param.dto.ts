import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/**
 * The path params carrying a canonical symbol id, for `PATCH`/`DELETE
 * /symbols/:id` — mirrors the old TypeBox `SymbolIdParamSchema`.
 */
export class SymbolIdParamDto {
  /**
   * Canonical symbol id, e.g. `"crypto:BTCUSDT"`.
   */
  @ApiProperty({ description: 'Canonical symbol id (`<type>:<ticker>`).' })
  @IsString()
  id!: string;
}
