import type { Candle, CandleRepository, Period } from '@lametrader/core';

import type { SeriesSample, SeriesView } from './series.types.js';

/**
 * The OHLCV axis a {@link barSeries} call projects out of each candle.
 *
 * Mirrors the v2 operand kinds OHLCV operands resolve to (per #388).
 */
export enum BarAxis {
  /** The candle's open price. */
  Open = 'open',
  /** The candle's high price. */
  High = 'high',
  /** The candle's low price. */
  Low = 'low',
  /** The candle's close price. */
  Close = 'close',
  /**
   * The candle's traded volume.
   * FX candles have no volume — they contribute no sample to a `Volume`
   * series.
   */
  Volume = 'volume',
}

/**
 * Build a {@link SeriesView} over the per-axis values of the candles a
 * `CandleRepository` holds for `(symbolId, period)` within `[window.from, window.to)`.
 *
 * Reads live from the repo — no duplicate storage (per ADR 0016).
 * The returned samples are ascending by `ts` (newest last).
 * For `BarAxis.Volume` over FX candles (which have no `volume` field), the
 * axis is absent — those candles contribute no sample to the resulting view.
 */
export async function barSeries(
  repo: CandleRepository,
  symbolId: string,
  period: Period,
  axis: BarAxis,
  window: { from: number; to: number },
): Promise<SeriesView> {
  const candles = await repo.range(symbolId, period, window.from, window.to);
  const samples: SeriesSample[] = [];
  for (const candle of candles) {
    const value = extractAxis(candle, axis);
    if (value !== null) {
      samples.push({ ts: candle.time, value });
    }
  }
  return new BarSeriesView(samples);
}

/** In-memory {@link SeriesView} over a frozen samples array. */
class BarSeriesView implements SeriesView {
  constructor(private readonly data: readonly SeriesSample[]) {}

  length(): number {
    return this.data.length;
  }

  samples(): readonly SeriesSample[] {
    return this.data;
  }

  latest(): SeriesSample | null {
    return this.data.length === 0 ? null : (this.data[this.data.length - 1] as SeriesSample);
  }

  asOf(asOfTs: number): SeriesSample | null {
    for (let i = this.data.length - 1; i >= 0; i--) {
      const sample = this.data[i] as SeriesSample;
      if (sample.ts <= asOfTs) return sample;
    }
    return null;
  }
}

function extractAxis(candle: Candle, axis: BarAxis): number | null {
  switch (axis) {
    case BarAxis.Open:
      return candle.open;
    case BarAxis.High:
      return candle.high;
    case BarAxis.Low:
      return candle.low;
    case BarAxis.Close:
      return candle.close;
    case BarAxis.Volume:
      return 'volume' in candle ? candle.volume : null;
  }
}
