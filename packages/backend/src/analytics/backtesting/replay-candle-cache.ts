import { type Candle, type CandleRepository, type Period, periodMillis } from '@lametrader/core';

/**
 * How many candles' worth of history to prefetch **forward** of the requested
 * `before` on a miss — so the next `READAHEAD` candles' fan-out reads all hit
 * the cached window instead of each hitting the store.
 *
 * The forward span is `periodMillis(period) * READAHEAD`, so it is candle-count
 * correct per period (a 1m and a 1h read both prefetch `READAHEAD` bars ahead,
 * not a fixed wall-clock span).
 *
 * ponytail: fixed constant; lift to `deriveMaxLookback`-driven sizing only if a
 * deep-lookback operator proves a page too small in profiling.
 */
const READAHEAD = 64;

/**
 * One remembered forward window for a `(symbolId, period)` series: the exclusive
 * bound it covers up to, the candles (newest-first), and whether the fetch
 * exhausted the history below the bound (fewer candles returned than requested).
 */
interface CachedPage {
  /**
   * Exclusive upper bound the window covers — the requested `before` shifted
   * `READAHEAD` periods forward, so reads with a `before` up to here are served
   * from cache (`+Infinity` for an open read).
   */
  before: number;
  /** The window as `latestN` returned it — newest-first, extending forward of the requested `before`. */
  candles: Candle[];
  /** `true` when the fetch returned fewer than requested — no older candle exists below the bound. */
  exhausted: boolean;
}

/**
 * A read-through {@link CandleRepository} decorator that remembers, per
 * `(symbolId, period)`, a rolling window of candles reaching `READAHEAD` periods
 * **forward** of the last requested `before`, and serves any later read whose
 * `before` that window already covers.
 *
 * Two redundancies collapse. Within one replayed candle, the fan-out events
 * (`BarOpened`/`BarClosed`/`Tick`) all page the bar series at the **same**
 * observation timestamp — an identical `(symbolId, period, before)` read. Across
 * candles, replay marches `before` forward, so a window prefetched ahead of the
 * current bar serves the next `READAHEAD` candles too. One store round-trip
 * covers a whole `READAHEAD`-candle stretch instead of one per candle.
 *
 * Transparent: every returned slice is filtered to `time < before`, byte-identical
 * to what the wrapped repository would return, so a replay's results never change
 * — the prefetched forward candles stay cached but never leak into an earlier
 * read (no look-ahead). It is safe only because it is **backtest-scoped and
 * short-lived** (one instance per replay), reading a fixed window whose
 * already-closed candles do not change under it; a live feed whose forming bar
 * mutates must not use it. Only `latestN` is cached — `range`, `latest`, and
 * writes pass straight through.
 */
export class ReplayCandleCache implements CandleRepository {
  /** Rolling forward window per `${symbolId}|${period}` series. */
  private readonly pages = new Map<string, CachedPage>();

  /**
   * @param inner - the wrapped repository every miss (and every non-`latestN` op) delegates to.
   */
  constructor(private readonly inner: CandleRepository) {}

  async latestN(symbolId: string, period: Period, n: number, before?: number): Promise<Candle[]> {
    const key = `${symbolId}|${period}`;
    const eff = before ?? Number.POSITIVE_INFINITY;
    const cached = this.pages.get(key);
    if (cached !== undefined && eff <= cached.before) {
      // The cached window covers every candle below `cached.before`; those below
      // `eff` are the newest below `eff`, contiguous and newest-first. Serve only
      // when we can prove they are the full answer: either we have at least `n`
      // of them, or the fetch exhausted the history so there are no older ones.
      const below = cached.candles.filter((candle) => candle.time < eff);
      if (below.length >= n || cached.exhausted) return below.slice(0, n);
    }
    // Miss: fetch a window that reaches `READAHEAD` candles *forward* of `before`
    // (by shifting the bound) plus `n` back, so the next `READAHEAD` candles read
    // from cache. `want` = `n` back + `READAHEAD` forward; the fetch is newest-first.
    const span = before === undefined ? 0 : periodMillis(period) * READAHEAD;
    const fetchBefore = before === undefined ? undefined : before + span;
    const want = n + READAHEAD;
    const page = await this.inner.latestN(symbolId, period, want, fetchBefore);
    this.pages.set(key, { before: eff + span, candles: page, exhausted: page.length < want });
    // The engine asked for `< before`; the fetch pulled forward candles too, so
    // gate the return exactly like the serve path — forward candles stay cached
    // for the next reads but never leak into this one (no look-ahead).
    return page.filter((candle) => candle.time < eff).slice(0, n);
  }

  range(
    symbolId: string,
    period: Period,
    from: number,
    to: number,
    limit?: number,
  ): Promise<Candle[]> {
    return this.inner.range(symbolId, period, from, to, limit);
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
}
