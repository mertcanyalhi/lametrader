import { type Candle, type CandleRepository, type Period, StateValueType } from '@lametrader/core';

import type { SeriesPoint, SeriesView } from './series.types.js';

/**
 * Which OHLCV axis the {@link BarSeriesView} projects out of each candle.
 *
 * Crypto and equity candles carry `volume`; FX candles do not — `volume` on
 * an FX series resolves to `null` at the candle level and the corresponding
 * point is omitted.
 */
export type BarAxis = 'open' | 'high' | 'low' | 'close' | 'volume';

/**
 * Read-only bar-axis projection over a `(symbolId, period)` window of the
 * candle repository.
 *
 * Bars themselves are persisted elsewhere — this is a thin view, not a copy
 * (hybrid storage per ADR 0016: bars read live from `CandleRepository`).
 * The window snapshot is fetched once in {@link BarSeriesView.load} and held
 * in-memory for the lifetime of the evaluation; subsequent queries don't
 * re-touch the repository.
 */
export class BarSeriesView implements SeriesView {
  /**
   * Build a view by loading candles from `repo` over `[from, to)` and
   * projecting the requested `axis`.
   *
   * Candles missing the axis (e.g. `volume` on an FX candle) are skipped.
   */
  static async load(
    repo: CandleRepository,
    symbolId: string,
    period: Period,
    from: number,
    to: number,
    axis: BarAxis,
  ): Promise<BarSeriesView> {
    const candles = await repo.range(symbolId, period, from, to);
    const points: SeriesPoint[] = [];
    for (const candle of candles) {
      const v = readAxis(candle, axis);
      if (v !== null) {
        points.push({ ts: candle.time, value: { type: StateValueType.Number, value: v } });
      }
    }
    return new BarSeriesView(points);
  }

  /** Points in ascending `ts` order, populated by {@link load}. */
  private constructor(private readonly points: readonly SeriesPoint[]) {}

  get length(): number {
    return this.points.length;
  }

  /** Iterate the projected points newest-first. */
  *backwardWalk(): IterableIterator<SeriesPoint> {
    for (let i = this.points.length - 1; i >= 0; i -= 1) {
      // Lazy: index math is bounds-checked above; TS can't see that.
      const point = this.points[i];
      if (point !== undefined) yield point;
    }
  }

  /**
   * Latest in-window point with `ts <= queryTs`, or `null` when none qualify.
   *
   * Walks backwards — the typical "current bar" query hits the first point.
   */
  asOf(queryTs: number): SeriesPoint | null {
    for (const point of this.backwardWalk()) {
      if (point.ts <= queryTs) return point;
    }
    return null;
  }
}

/**
 * Pull one OHLCV axis off a candle. Returns `null` for axes the candle's
 * shape doesn't carry (notably `volume` on FX).
 */
function readAxis(candle: Candle, axis: BarAxis): number | null {
  switch (axis) {
    case 'open':
      return candle.open;
    case 'high':
      return candle.high;
    case 'low':
      return candle.low;
    case 'close':
      return candle.close;
    case 'volume':
      return 'volume' in candle ? candle.volume : null;
  }
}
