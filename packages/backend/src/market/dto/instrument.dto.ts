import { SymbolType } from '@lametrader/core';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The `200` response shape of a discovered instrument (`GET /instruments`).
 *
 * Documentation only — pins the OpenAPI contract; responses are not validated.
 * `currency` is optional: present from Binance and a Yahoo lookup, absent from a
 * Yahoo search hit.
 */
export class InstrumentDto {
  /** Canonical id, e.g. `"crypto:BTCUSDT"`. */
  @ApiProperty()
  id!: string;

  /** Asset class (also the id's prefix). */
  @ApiProperty({ enum: SymbolType })
  type!: SymbolType;

  /** Human-readable name, e.g. `"Bitcoin / TetherUS"`. */
  @ApiProperty()
  description!: string;

  /** Venue / exchange, e.g. `"Binance"`. */
  @ApiProperty()
  exchange!: string;

  /** Pricing currency (optional, source-dependent). */
  @ApiPropertyOptional()
  currency?: string;
}
