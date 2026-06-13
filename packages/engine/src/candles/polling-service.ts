import {
  type CandleRepository,
  MarketDataError,
  type MarketDataSource,
  type Period,
  periodMillis,
  SymbolError,
  type SymbolType,
  symbolType,
  type WatchedSymbol,
  type WatchlistRepository,
} from '@lametrader/core';
import type { PollingOptions } from './polling-service.types.js';

/**
 * Fraction of a period's interval added as random jitter on top of the floor, so
 * symbols sharing a period don't hit the provider in lockstep.
 */
const JITTER_FRACTION = 0.5;

/**
 * Application use-case for **continuous polling + live candle streaming** (slice 3).
 *
 * For every watched symbol+period it resumes from storage — the durable cursor —
 * by fetching `{ from: latest.time, to: now }` and upserting the result, so a
 * restart picks up where it left off and re-fetching the still-forming bar simply
 * updates it. Each fetched candle is emitted via the `onCandle` callback; the
 * service stays transport-agnostic (the WebSocket rendering lives in the API
 * adapter — see ADR-0005).
 *
 * Depends only on ports: {@link WatchlistRepository}, {@link MarketDataSource},
 * {@link CandleRepository}.
 */
export class PollingService {
  /** Current clock (injectable). */
  private readonly now: () => number;
  /** Jitter source (injectable). */
  private readonly random: () => number;
  /** Pending per-period timers while running; empty when stopped. */
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  /** Whether the loop is active (gates rescheduling after `stop`). */
  private running = false;

  /**
   * @param sources - market-data providers, one or more per asset class.
   * @param candles - the candle persistence port (also the resume cursor).
   * @param watchlist - the watchlist persistence port.
   * @param options - event sink, per-period cadence, and injectable clock/jitter.
   */
  constructor(
    private readonly sources: MarketDataSource[],
    private readonly candles: CandleRepository,
    private readonly watchlist: WatchlistRepository,
    private readonly options: PollingOptions,
  ) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }

  /**
   * Start the loop: schedule a recurring poll per period at its configured
   * interval plus jitter. Idempotent — a second call while running is a no-op.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    for (const period of Object.keys(this.options.intervals) as Period[]) {
      this.schedule(period);
    }
  }

  /**
   * Stop the loop: cancel all pending timers; no further polls fire.
   */
  stop(): void {
    this.running = false;
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  /**
   * One full sweep over every watched symbol+period: resume from `latest`, fetch
   * the new window, persist it, and emit each fetched candle. A symbol+period with
   * no stored candles is skipped (assume backfill ran first); a provider failure
   * on one symbol is caught and skipped so the sweep continues.
   */
  async poll(): Promise<void> {
    const watched = await this.watchlist.list();
    for (const symbol of watched) {
      for (const period of symbol.periods) {
        await this.pollOne(symbol, period);
      }
    }
  }

  /**
   * Schedule the next poll for one period after `interval * (1 + jitter)`,
   * re-scheduling itself while running.
   */
  private schedule(period: Period): void {
    const interval = this.options.intervals[period];
    const delay = interval * (1 + this.random() * JITTER_FRACTION);
    const timer = setTimeout(async () => {
      this.timers.delete(timer);
      await this.pollPeriod(period);
      if (this.running) this.schedule(period);
    }, delay);
    this.timers.add(timer);
  }

  /**
   * Poll every watched symbol that carries `period` (re-reading the watchlist so
   * additions/removals take effect on the next tick).
   */
  private async pollPeriod(period: Period): Promise<void> {
    const watched = await this.watchlist.list();
    for (const symbol of watched) {
      if (symbol.periods.includes(period)) {
        await this.pollOne(symbol, period);
      }
    }
  }

  /**
   * Resume one symbol+period from storage, persist the fetched window, and emit
   * each candle. Skips when nothing is stored yet; swallows a {@link MarketDataError}
   * so one bad provider response doesn't kill the loop.
   */
  private async pollOne(symbol: WatchedSymbol, period: Period): Promise<void> {
    try {
      const latest = await this.candles.latest(symbol.id, period);
      if (!latest) return;
      const source = this.sourceForType(symbolType(symbol.id));
      const now = this.now();
      const { candles } = await source.fetchCandles(symbol.id, period, {
        from: latest.time,
        to: now,
      });
      if (candles.length === 0) return;
      await this.candles.save(symbol.id, period, candles);
      const span = periodMillis(period);
      for (const candle of candles) {
        this.options.onCandle({ id: symbol.id, period, candle, final: candle.time + span <= now });
      }
    } catch (error) {
      if (error instanceof MarketDataError) return;
      throw error;
    }
  }

  /**
   * Resolve the source that serves a given asset type.
   *
   * @throws {@link SymbolError} when no registered source serves the type.
   */
  private sourceForType(type: SymbolType): MarketDataSource {
    const source = this.sources.find((candidate) => candidate.types.includes(type));
    if (!source) {
      throw new SymbolError(`no market-data source for type: ${type}`);
    }
    return source;
  }
}
