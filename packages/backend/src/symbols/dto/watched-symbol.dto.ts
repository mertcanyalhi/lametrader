import { Period, SymbolType } from '@lametrader/core';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The `200`/`201` response shape of a watched symbol — a discovered instrument
 * plus its per-symbol periods (`GET`/`POST`/`PATCH /symbols`).
 *
 * Documentation only — pins the OpenAPI contract; responses are not validated.
 */
export class WatchedSymbolDto {
  /** Canonical id, e.g. `"crypto:BTCUSDT"`. */
  @ApiProperty()
  id!: string;

  /** Asset class (also the id's prefix). */
  @ApiProperty({ enum: SymbolType })
  type!: SymbolType;

  /** Human-readable name. */
  @ApiProperty()
  description!: string;

  /** Venue / exchange. */
  @ApiProperty()
  exchange!: string;

  /** Pricing currency (optional, source-dependent). */
  @ApiPropertyOptional()
  currency?: string;

  /** The per-symbol periods maintained for this symbol. */
  @ApiProperty({ enum: Period, isArray: true })
  periods!: Period[];
}
