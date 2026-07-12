import { type Candle, type CandleRepository, type Period, periodMillis } from '@lametrader/core';
import { Logger } from '@nestjs/common';

/**
 * One preloaded `(symbolId, period)` series: the resident candles plus the
 * bounds they cover, so a read outside the window can be recognised and
 * delegated.
 */
export interface PreloadedSeriesEntry {
  /** The symbol the series belongs to. */
  symbolId: string;
  /** The period the series is sampled at. */
  period: Period;
  /** Oldest time loaded (inclusive); a read reaching below this delegates to the store. */
  floor: number;
  /** Exclusive upper bound loaded; a read reaching at/above this delegates to the store. */
  end: number;
  /** The resident candles, ascending by time — exactly `inner.range(symbolId, period, floor, end)`. */
  candles: Candle[];
  /**
   * `true` when no candle exists **below** `floor` in the store, so the window
   * bottoms out at the true start of history — a short slice is then the *full*
   * answer and can be served from memory rather than delegated.
   */
  completeBelow: boolean;
}

/** Internal resident window per `${symbolId}|${period}`. */
interface ResidentSeries {
  floor: number;
  end: number;
  candles: Candle[];
  completeBelow: boolean;
}

/**
 * A read-through {@link CandleRepository} holding a preloaded `[floor, end)`
 * window per `(symbolId, period)` and serving every read that window covers from
 * memory, delegating anything it cannot fully satisfy to the wrapped store
 * (ADR-0022).
 *
 * It is a **performance layer, not a correctness authority**: the window is
 * sized by an over-approximating analyzer ({@link import('./derive-preload-bars.js').derivePreloadBars}),
 * so a `Crossing` / `Channel` walk-past-flats can reach below the floor. Rather
 * than fail or silently truncate, such a read falls through to the store (and is
 * logged), so the replay's result is identical whether or not the window was
 * sized deep enough — the analyzer only decides how often the fallback fires.
 *
 * The load-bearing invariant is that a read the window cannot **fully** satisfy
 * is delegated whole, never answered with a floor-truncated short slice: the
 * series pagers treat a short page as "history exhausted", so a truncated answer
 * would silently corrupt results. Backtest-scoped and short-lived (one per run),
 * reading a fixed window whose closed candles do not change under it.
 */
export class PreloadedCandleRepository implements CandleRepository {
  /** Scoped logger for floor-breach diagnostics. */
  private readonly logger = new Logger(PreloadedCandleRepository.name);
  /** Resident window per `${symbolId}|${period}`; a miss delegates entirely. */
  private readonly series = new Map<string, ResidentSeries>();

  /**
   * @param inner - the wrapped store every below-window read (and every write) delegates to.
   * @param series - the preloaded windows, one per `(symbolId, period)`.
   */
  constructor(
    private readonly inner: CandleRepository,
    series: readonly PreloadedSeriesEntry[],
  ) {
    for (const entry of series) {
      this.series.set(key(entry.symbolId, entry.period), {
        floor: entry.floor,
        end: entry.end,
        candles: entry.candles,
        completeBelow: entry.completeBelow,
      });
    }
  }

  async range(
    symbolId: string,
    period: Period,
    from: number,
    to: number,
    limit?: number,
  ): Promise<Candle[]> {
    const resident = this.series.get(key(symbolId, period));
    // Serve only a range the window fully covers. A `from` below the floor is
    // covered when nothing exists below it (`completeBelow`); otherwise, or when
    // `to` reaches past the loaded end (a candle could sit beyond it), delegate.
    const belowFloor = resident !== undefined && from < resident.floor && !resident.completeBelow;
    if (resident === undefined || belowFloor || to > resident.end) {
      if (belowFloor) this.logBreach('range', symbolId, period, from);
      return this.inner.range(symbolId, period, from, to, limit);
    }
    if (limit !== undefined && limit <= 0) return [];
    const matched = resident.candles.filter((candle) => candle.time >= from && candle.time < to);
    return limit === undefined ? matched : matched.slice(0, limit);
  }

  async latestN(
    symbolId: string,
    period: Period,
    n: number,
    before = Number.POSITIVE_INFINITY,
  ): Promise<Candle[]> {
    const resident = this.series.get(key(symbolId, period));
    // A `before` above the loaded end could hide newer candles beyond the window,
    // so only an in-window `before` is eligible to be served from memory.
    if (resident === undefined || before > resident.end) {
      return this.inner.latestN(symbolId, period, n, before);
    }
    if (n <= 0) return [];
    const candidates = resident.candles
      .filter((candle) => candle.time < before)
      .slice(-n)
      .reverse();
    // A full answer, or a short one the window proves is complete (nothing older
    // exists below the floor), is served from memory. Otherwise the missing
    // older candles sit below the floor, so delegate the whole read.
    if (candidates.length >= n || resident.completeBelow) return candidates;
    this.logBreach('latestN', symbolId, period, before);
    return this.inner.latestN(symbolId, period, n, before);
  }

  latest(symbolId: string, period: Period): Promise<Candle | null> {
    return this.inner.latest(symbolId, period);
  }

  save(symbolId: string, period: Period, candles: Candle[]): Promise<void> {
    return this.inner.save(symbolId, period, candles);
  }

  deleteSymbol(symbolId: string): Promise<void> {
    return this.inner.deleteSymbol(symbolId);
  }

  /** Log a below-window read at debug — a chronically-too-shallow window is visible without spamming. */
  private logBreach(op: string, symbolId: string, period: Period, bound: number): void {
    this.logger.debug(
      `preload window breached on ${op} ${symbolId} ${period} at ${bound}; delegating to the store`,
    );
  }
}

/**
 * Preload `[start − bars × periodMillis(period), end)` per active period from
 * `inner` and wrap it in a {@link PreloadedCandleRepository}, so the replay reads
 * from memory with a read-through fallback below the floor.
 *
 * @param inner - the shared candle store to preload from (and fall back to).
 * @param symbolId - the run's symbol.
 * @param periods - the symbol's active periods to preload.
 * @param bars - the per-period lookback depth ({@link import('./derive-preload-bars.js').derivePreloadBars}).
 * @param start - the run window start (inclusive), epoch ms.
 * @param end - the run window end (exclusive), epoch ms.
 */
export async function preloadCandleRepository(
  inner: CandleRepository,
  symbolId: string,
  periods: readonly Period[],
  bars: number,
  start: number,
  end: number,
): Promise<PreloadedCandleRepository> {
  const series = await Promise.all(
    periods.map(async (period): Promise<PreloadedSeriesEntry> => {
      const floor = start - bars * periodMillis(period);
      const [candles, older] = await Promise.all([
        inner.range(symbolId, period, floor, end),
        // One probe below the floor decides whether a short read is complete: no
        // older candle means the window bottoms out at the true start of history.
        inner.latestN(symbolId, period, 1, floor),
      ]);
      return { symbolId, period, floor, end, candles, completeBelow: older.length === 0 };
    }),
  );
  return new PreloadedCandleRepository(inner, series);
}

/** Key a resident series by symbol id and period. */
function key(symbolId: string, period: Period): string {
  return `${symbolId}|${period}`;
}
