import type { Candle, CandleRepository, Period } from '@lametrader/core';

/**
 * A {@link CandleRepository} backed by in-memory maps. Real (not a test double):
 * backs the unit tier and the shared repository contract. Candles are keyed by
 * `(symbol, period, time)` so re-saving a `time` replaces it.
 */
export class InMemoryCandleRepository implements CandleRepository {
  /**
   * Series keyed by `${symbolId}|${period}`; each a map of `time → Candle`.
   */
  private readonly series = new Map<string, Map<number, Candle>>();

  async save(symbolId: string, period: Period, candles: Candle[]): Promise<void> {
    const key = seriesKey(symbolId, period);
    const byTime = this.series.get(key) ?? new Map<number, Candle>();
    for (const candle of candles) {
      byTime.set(candle.time, candle);
    }
    this.series.set(key, byTime);
  }

  async range(
    symbolId: string,
    period: Period,
    from: number,
    to: number,
    limit?: number,
  ): Promise<Candle[]> {
    const matched = this.sorted(symbolId, period).filter(
      (candle) => candle.time >= from && candle.time < to,
    );
    return limit === undefined ? matched : matched.slice(0, limit);
  }

  async latest(symbolId: string, period: Period): Promise<Candle | null> {
    const sorted = this.sorted(symbolId, period);
    return sorted.at(-1) ?? null;
  }

  async deleteSymbol(symbolId: string): Promise<void> {
    const prefix = `${symbolId}|`;
    for (const key of this.series.keys()) {
      if (key.startsWith(prefix)) this.series.delete(key);
    }
  }

  /**
   * All stored candles for a symbol+period, ascending by `time`.
   */
  private sorted(symbolId: string, period: Period): Candle[] {
    const byTime = this.series.get(seriesKey(symbolId, period));
    if (!byTime) return [];
    return [...byTime.values()].sort((a, b) => a.time - b.time);
  }
}

/**
 * Key a candle series by symbol id and period.
 */
function seriesKey(symbolId: string, period: Period): string {
  return `${symbolId}|${period}`;
}
