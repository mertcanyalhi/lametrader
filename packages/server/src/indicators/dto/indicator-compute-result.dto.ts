import { Period } from '@lametrader/core';
import { ApiProperty } from '@nestjs/swagger';

/**
 * One row of a compute result: a `time` plus the indicator's arbitrary state
 * fields (each state descriptor's `key` carrying its per-bar value, or `null`
 * during warm-up / non-firing bars). Mirrors the old TypeBox
 * `IndicatorStatePointSchema` (`additionalProperties: true`); the per-indicator
 * state keys are open-ended, so only the always-present `time` is documented.
 *
 * Documentation only — pins the OpenAPI contract; responses are not validated.
 */
export class IndicatorStatePointDto {
  /** Candle open time, epoch ms. */
  @ApiProperty({ description: 'Candle open time (epoch ms).' })
  time!: number;

  /** State fields keyed by the indicator's own state descriptor keys. */
  [key: string]: unknown;
}

/**
 * The compute route's 200 response — the aligned state series for a symbol's
 * stored candles at a period. Mirrors the old TypeBox `IndicatorComputeResultSchema`.
 *
 * Documentation only — pins the OpenAPI contract; the runtime body is the
 * service's `IndicatorComputeResult`, returned verbatim.
 */
export class IndicatorComputeResultDto {
  /** The indicator that produced the result. */
  @ApiProperty({ description: 'The indicator key that produced the result.' })
  indicatorKey!: string;

  /** The `definition.version` at compute time. */
  @ApiProperty()
  version!: number;

  /** The period the candles were sampled at. */
  @ApiProperty({ enum: Period })
  period!: Period;

  /** The aligned state series, one row per included candle. */
  @ApiProperty({ type: IndicatorStatePointDto, isArray: true })
  state!: IndicatorStatePointDto[];
}
