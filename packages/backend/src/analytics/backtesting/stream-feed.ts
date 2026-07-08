import { type Candle, type CandleRepository, type Period, periodMillis } from '@lametrader/core';
import type { FeedCandle } from './backtest-replay.service.js';
import type { CompletionKey } from './stream-feed.types.js';

/**
 * How many candles one period cursor pulls per repository round-trip — the
 * per-period read-ahead depth of {@link streamFeed} (design §1/§5 of
 * `docs/designs/streaming-backtest-feed.md`).
 *
 * Bounded and tunable: a smaller chunk trades more `range` round-trips for a
 * smaller in-flight buffer.
 */
export const FEED_CHUNK = 4096;

/**
 * An ascending, chunked cursor over one period's stored candles in
 * `[start, end)`.
 *
 * Pulls fixed-size chunks via the repository's ascending
 * `range(symbolId, period, from, to, limit)`, so the merge never holds more
 * than one read-ahead chunk of this period in memory and newest data is not
 * loaded until the merge reaches it.
 */
export class PeriodFeedCursor {
  /** The current read-ahead chunk, ascending by `time`. */
  private buffer: Candle[] = [];
  /** Index of the next unconsumed candle within {@link buffer}. */
  private index = 0;
  /** Inclusive lower bound of the next repository chunk. */
  private nextFrom: number;
  /** Set once a short page proves the store holds nothing further before `end`. */
  private exhausted = false;

  /**
   * @param candles - the candle store the cursor pages.
   * @param symbolId - the symbol whose series is streamed.
   * @param period - the period whose series is streamed.
   * @param start - inclusive lower bound of the streamed window (epoch ms).
   * @param end - exclusive upper bound of the streamed window (epoch ms).
   * @param chunkSize - candles per repository round-trip; defaults to {@link FEED_CHUNK}.
   */
  constructor(
    private readonly candles: CandleRepository,
    private readonly symbolId: string,
    private readonly period: Period,
    start: number,
    private readonly end: number,
    private readonly chunkSize: number = FEED_CHUNK,
  ) {
    this.nextFrom = start;
  }

  /**
   * The next candle without consuming it, refilling the buffer on demand —
   * `undefined` once the window is exhausted.
   */
  async peek(): Promise<Candle | undefined> {
    if (this.index >= this.buffer.length) await this.refill();
    return this.buffer[this.index];
  }

  /**
   * Consume and return the next candle — `undefined` once the window is
   * exhausted.
   */
  async take(): Promise<Candle | undefined> {
    const candle = await this.peek();
    if (candle !== undefined) this.index += 1;
    return candle;
  }

  /**
   * Pull the next chunk from the repository. A short page marks the cursor
   * exhausted (nothing further is stored before `end`); the next chunk starts
   * strictly after the last candle just pulled.
   */
  private async refill(): Promise<void> {
    this.buffer = [];
    this.index = 0;
    while (!this.exhausted && this.buffer.length === 0) {
      const page = await this.candles.range(
        this.symbolId,
        this.period,
        this.nextFrom,
        this.end,
        this.chunkSize,
      );
      if (page.length < this.chunkSize) this.exhausted = true;
      const last = page.at(-1);
      if (last === undefined) return;
      this.buffer = page;
      this.nextFrom = last.time + 1;
    }
  }
}

/**
 * The completion-time sort key of `candle` on `period` — identical to
 * {@link import('./backtest-replay.service.js').orderBacktestFeed}'s comparator:
 * completion time first, period duration as the finest-period tie-break.
 */
export function completionKey(candle: Candle, period: Period): CompletionKey {
  const millis = periodMillis(period);
  return [candle.time + millis, millis];
}

/**
 * Lexicographic compare of two {@link CompletionKey}s — earlier completion
 * first, finer period first on completion ties; `false` for equal keys.
 */
export function lessThan(a: CompletionKey, b: CompletionKey): boolean {
  return a[0] !== b[0] ? a[0] < b[0] : a[1] < b[1];
}

/**
 * Stream the k-way merge of each period's stored candles in `[start, end)`,
 * ordered exactly as
 * {@link import('./backtest-replay.service.js').orderBacktestFeed} orders them
 * today: by completion time, ties broken finest-period-first.
 *
 * Opens one {@link PeriodFeedCursor} per period and repeatedly emits the
 * cursor whose head candle has the smallest {@link completionKey}, so the
 * merged order is a total order identical to the eager sort while never
 * holding more than one read-ahead chunk per period in memory (design §1 of
 * `docs/designs/streaming-backtest-feed.md`).
 *
 * @param candles - the candle store the per-period cursors page.
 * @param symbolId - the symbol whose series are merged.
 * @param periods - the active periods to merge.
 * @param start - inclusive lower bound of the streamed window (epoch ms).
 * @param end - exclusive upper bound of the streamed window (epoch ms).
 * @param chunkSize - per-cursor read-ahead depth; defaults to {@link FEED_CHUNK}.
 */
export async function* streamFeed(
  candles: CandleRepository,
  symbolId: string,
  periods: Period[],
  start: number,
  end: number,
  chunkSize: number = FEED_CHUNK,
): AsyncGenerator<FeedCandle> {
  const cursors = periods.map((period) => ({
    period,
    cursor: new PeriodFeedCursor(candles, symbolId, period, start, end, chunkSize),
  }));
  while (true) {
    let best:
      | { period: Period; cursor: PeriodFeedCursor; candle: Candle; key: CompletionKey }
      | undefined;
    for (const { period, cursor } of cursors) {
      const head = await cursor.peek();
      if (head === undefined) continue;
      const key = completionKey(head, period);
      if (best === undefined || lessThan(key, best.key)) {
        best = { period, cursor, candle: head, key };
      }
    }
    if (best === undefined) return;
    await best.cursor.take();
    yield { period: best.period, candle: best.candle };
  }
}
