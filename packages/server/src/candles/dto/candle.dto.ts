import { SymbolType } from '@lametrader/core';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * A stored OHLC candle — the shared OHLC base plus the optional per-asset-class
 * fields (crypto: `volume`/`quoteVolume`/`trades`; equity: `volume`; FX: none), a
 * flat transport view of the domain's typed `Candle` union. `time` is the open
 * time, epoch ms. Mirrors the old TypeBox `CandleSchema`.
 *
 * Documentation only — pins the OpenAPI contract; responses are not validated.
 */
export class CandleDto {
  /** Asset-class discriminant. */
  @ApiProperty({ enum: SymbolType })
  type!: SymbolType;

  /** Candle open time, epoch ms. */
  @ApiProperty()
  time!: number;

  /** Open price. */
  @ApiProperty()
  open!: number;

  /** Highest traded price in the interval. */
  @ApiProperty()
  high!: number;

  /** Lowest traded price in the interval. */
  @ApiProperty()
  low!: number;

  /** Close price. */
  @ApiProperty()
  close!: number;

  /** Traded volume (crypto/equity only). */
  @ApiPropertyOptional()
  volume?: number;

  /** Quote-asset volume (crypto only). */
  @ApiPropertyOptional()
  quoteVolume?: number;

  /** Trade count (crypto only). */
  @ApiPropertyOptional()
  trades?: number;
}
