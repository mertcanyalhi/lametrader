import { Period } from '@lametrader/core';
import { ApiProperty } from '@nestjs/swagger';

/**
 * A point-in-time quote for a symbol — latest price plus period-over-period
 * change — attached to each item of `GET /symbols?enrich=true`.
 *
 * Documentation only — pins the OpenAPI contract; responses are not validated.
 */
export class SymbolQuoteDto {
  /** Latest close price. */
  @ApiProperty()
  price!: number;

  /** Period-over-period change (`latestClose − previousClose`). */
  @ApiProperty()
  change!: number;

  /** Change as a fraction of the previous close (`change / previousClose`). */
  @ApiProperty()
  changePct!: number;

  /** The period the quote was computed on (the config's `defaultPeriod`). */
  @ApiProperty({ enum: Period })
  period!: Period;

  /** The latest candle's open time, epoch ms. */
  @ApiProperty()
  time!: number;
}
