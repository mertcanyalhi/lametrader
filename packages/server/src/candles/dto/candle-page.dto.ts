import { ApiProperty } from '@nestjs/swagger';
import { CandleDto } from './candle.dto.js';

/**
 * One keyset-paginated page of stored candles — the `200` response of
 * `GET /symbols/:id/candles`. Mirrors the old TypeBox `CandlePageSchema`.
 *
 * Documentation only — pins the OpenAPI contract; responses are not validated.
 */
export class CandlePageDto {
  /** The page's candles, ascending by `time`. */
  @ApiProperty({ type: CandleDto, isArray: true })
  candles!: CandleDto[];

  /** The next page's `from` (`time` of the first excluded candle), or `null`. */
  @ApiProperty({ type: Number, nullable: true })
  nextCursor!: number | null;

  /** The latest stored candle's `time` for this `(symbol, period)`, or `null`. */
  @ApiProperty({ type: Number, nullable: true })
  latestTime!: number | null;
}
