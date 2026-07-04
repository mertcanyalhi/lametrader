import { Period, SymbolType } from '@lametrader/core';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SymbolQuoteDto } from './symbol-quote.dto.js';

/**
 * The `200` response shape of a watched symbol enriched with its quote — one
 * item of `GET /symbols?enrich=true`. `quote` is `null` when the symbol does not
 * watch the `defaultPeriod` or has fewer than two candles stored there.
 *
 * Documentation only — pins the OpenAPI contract; responses are not validated.
 */
export class EnrichedSymbolDto {
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

  /** The computed quote, or `null` when none can be derived. */
  @ApiProperty({ type: SymbolQuoteDto, nullable: true })
  quote!: SymbolQuoteDto | null;
}
