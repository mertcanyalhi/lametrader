import {
  type BackfillRange,
  CandleError,
  type CandlePage,
  type CandleRepository,
  type MarketDataSource,
  type Period,
  SymbolNotFoundError,
  symbolType,
  type WatchlistRepository,
} from '@lametrader/core';
import { sourceForType } from '../symbols/source-registry.js';
import type { BackfillProgressListener, BackfillSummary } from './backfill-service.types.js';

/**
 * How many candles are persisted per `save` call (and per progress tick).
 */
const CHUNK_SIZE = 500;

/**
 * Application use-case for backfilling historical OHLC candles for a watched
 * symbol+period.
 *
 * Depends only on ports — the {@link MarketDataSource}s (fetch candles), a
 * {@link CandleRepository} (persistence), and the {@link WatchlistRepository}
 * (a backfill targets a symbol the user already watches). Progress is surfaced
 * via an `onProgress` callback so transports (CLI stdout, API WebSocket) render
 * it without the application knowing about them.
 */
export class BackfillService {
  /**
   * @param sources - market-data providers, one or more per asset class.
   * @param candles - the candle persistence port.
   * @param watchlist - the watchlist persistence port.
   */
  constructor(
    private readonly sources: MarketDataSource[],
    private readonly candles: CandleRepository,
    private readonly watchlist: WatchlistRepository,
  ) {}

  /**
   * Backfill candles for a watched symbol+period, persisting in chunks and
   * reporting progress after each.
   *
   * @param id - canonical symbol id (must be on the watchlist).
   * @param period - the period to backfill (must be one of the symbol's periods).
   * @param range - optional `[from, to)` window; omitted ⇒ provider-max history.
   * @param onProgress - optional per-chunk progress callback.
   * @throws {@link SymbolNotFoundError} when the symbol is not watched.
   * @throws {@link CandleError} when `period` is not among the symbol's periods.
   */
  async backfill(
    id: string,
    period: Period,
    range?: BackfillRange,
    onProgress?: BackfillProgressListener,
  ): Promise<BackfillSummary> {
    const watched = await this.watchlist.get(id);
    if (!watched) {
      throw new SymbolNotFoundError(`symbol not watched: ${id}`);
    }
    if (!watched.periods.includes(period)) {
      throw new CandleError(`period ${period} is not watched for ${id}`);
    }

    const source = sourceForType(this.sources, symbolType(id));
    const { candles: fetched, complete } = await source.fetchCandles(id, period, range);

    let saved = 0;
    for (let i = 0; i < fetched.length; i += CHUNK_SIZE) {
      const chunk = fetched.slice(i, i + CHUNK_SIZE);
      await this.candles.save(id, period, chunk);
      saved += chunk.length;
      onProgress?.({ saved, total: fetched.length });
    }

    const first = fetched.at(0);
    const last = fetched.at(-1);
    return {
      id,
      period,
      from: first?.time ?? null,
      to: last?.time ?? null,
      fetched: fetched.length,
      saved,
      complete,
    };
  }

  /**
   * Read one page of stored candles for a symbol+period within `[from, to)`,
   * ascending by `time`. Fetches `limit + 1` to probe for a next page: if more
   * than `limit` exist, returns the first `limit` and a `nextCursor` (the next
   * candle's `time`); otherwise returns all with `nextCursor = null`.
   *
   * @param id - canonical symbol id.
   * @param period - the period to read.
   * @param query - the `[from, to)` window and page `limit`.
   */
  async read(
    id: string,
    period: Period,
    query: { from: number; to: number; limit: number },
  ): Promise<CandlePage> {
    const { from, to, limit } = query;
    const rows = await this.candles.range(id, period, from, to, limit + 1);
    if (rows.length > limit) {
      const candles = rows.slice(0, limit);
      return { candles, nextCursor: rows[limit]?.time ?? null };
    }
    return { candles: rows, nextCursor: null };
  }
}
