import {
  type CandleRepository,
  type MarketDataSource,
  type Period,
  periodMillis,
  type WatchedSymbol,
  type WatchlistRepository,
} from '@lametrader/core';
import type { SchedulerRegistry } from '@nestjs/schedule';
import { MarketDataError, symbolType } from '../domain/symbol.js';
import { sourceForType } from '../market-data/source-registry.js';
import type { CandleEvent, CandleListener, PollingOptions } from './polling.service.types.js';

/**
 * Fraction of a period's interval added as random jitter on top of the floor, so
 * symbols sharing a period don't hit the provider in lockstep.
 */
const JITTER_FRACTION = 0.5;

/**
 * Prefix for the per-period {@link SchedulerRegistry} timeout name (`polling:1h`,
 * …), keeping the registry keyspace namespaced to this service.
 */
const TIMEOUT_PREFIX = 'polling:';

/**
 * Application use-case for **continuous polling + live candle streaming**.
 *
 * For every watched symbol+period it resumes from storage — the durable cursor —
 * by fetching `{ from: latest.time, to: now }` and upserting the result, so a
 * restart picks up where it left off and re-fetching the still-forming bar simply
 * updates it. Each fetched candle is emitted via the `onCandle` callback; the
 * service stays transport-agnostic (the WebSocket rendering is an adapter concern
 * — see ADR-0005).
 *
 * **Dormant by default.** Relocated from the engine but rewritten off raw
 * `setTimeout`/`SIGTERM` onto `@nestjs/schedule`'s {@link SchedulerRegistry}: each
 * period drives a named dynamic timeout that reschedules itself (the same
 * per-period chained cadence + jitter as before). Construction does **not** start
 * the loop — `start()` is never called at application boot; the cutover stage
 * (#490) starts it via a lifecycle hook and `stop()`s it on shutdown. This keeps
 * the ported server from polling third-party providers while the old `api` is
 * still the deployed backend.
 */
export class PollingService {
  /** Current clock (injectable). */
  private readonly now: () => number;
  /** Jitter source (injectable). */
  private readonly random: () => number;
  /** Whether the loop is active (gates rescheduling after `stop`). */
  private running = false;
  /**
   * Additional per-candle sinks registered on top of the constructor's
   * `options.onCandle` base sink (the live `/stream` candle hub).
   *
   * The cutover stage (#490) registers the live cascade here — it fans each
   * polled candle into the indicator, quote, and rule-engine producers — so the
   * base hub-publish and the cascade run off the one poll, reproducing the old
   * `connectServices` single `onCandle` closure without the candle owner
   * (`CandlesModule`) importing the downstream producer modules (which would
   * cycle).
   */
  private readonly extraListeners: CandleListener[] = [];

  /**
   * @param sources - market-data providers, one or more per asset class.
   * @param candles - the candle persistence port (also the resume cursor).
   * @param watchlist - the watchlist persistence port.
   * @param registry - the `@nestjs/schedule` registry the per-period timeouts live in.
   * @param options - event sink, per-period cadence, and injectable clock/jitter.
   */
  constructor(
    private readonly sources: MarketDataSource[],
    private readonly candles: CandleRepository,
    private readonly watchlist: WatchlistRepository,
    private readonly registry: SchedulerRegistry,
    private readonly options: PollingOptions,
  ) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }

  /**
   * Start the loop: schedule a recurring poll per period at its configured
   * interval plus jitter. Idempotent — a second call while running is a no-op.
   *
   * Not invoked at boot (see the class note); a lifecycle hook drives it at the
   * cutover stage.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    for (const period of Object.keys(this.options.intervals) as Period[]) {
      this.schedule(period);
    }
  }

  /**
   * Register an additional per-candle sink, run after the constructor's base sink
   * on every emitted candle. Returns an unsubscribe that detaches it.
   *
   * The cutover stage wires the live cascade through here so each polled candle
   * feeds the indicator, quote, and rule-engine producers alongside the base
   * `/stream` candle hub — reproducing the old `connectServices` `onCandle`
   * closure.
   */
  addCandleListener(listener: CandleListener): () => void {
    this.extraListeners.push(listener);
    return () => {
      const index = this.extraListeners.indexOf(listener);
      if (index !== -1) this.extraListeners.splice(index, 1);
    };
  }

  /**
   * Stop the loop: cancel every pending per-period timeout; no further polls fire.
   */
  stop(): void {
    this.running = false;
    for (const period of Object.keys(this.options.intervals) as Period[]) {
      const name = timeoutName(period);
      if (this.registry.doesExist('timeout', name)) {
        this.registry.deleteTimeout(name);
      }
    }
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
   * Schedule the next poll for one period after `interval * (1 + jitter)` as a
   * named dynamic timeout in the {@link SchedulerRegistry}.
   */
  private schedule(period: Period): void {
    const interval = this.options.intervals[period];
    const delay = interval * (1 + this.random() * JITTER_FRACTION);
    const timeout = setTimeout(() => {
      void this.fire(period);
    }, delay);
    this.registry.addTimeout(timeoutName(period), timeout);
  }

  /**
   * Handle a period's fired timeout: drop the (now-elapsed) registry entry so the
   * name is free, poll that period, then re-schedule while still running.
   */
  private async fire(period: Period): Promise<void> {
    this.registry.deleteTimeout(timeoutName(period));
    await this.pollPeriod(period);
    if (this.running) this.schedule(period);
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
      const source = sourceForType(this.sources, symbolType(symbol.id));
      const now = this.now();
      const { candles } = await source.fetchCandles(symbol.id, period, {
        from: latest.time,
        to: now,
      });
      if (candles.length === 0) return;
      await this.candles.save(symbol.id, period, candles);
      const span = periodMillis(period);
      for (const candle of candles) {
        this.emit({ id: symbol.id, period, candle, final: candle.time + span <= now });
      }
    } catch (error) {
      if (error instanceof MarketDataError) return;
      throw error;
    }
  }

  /**
   * Deliver one candle to the base sink and every registered extra sink, in
   * registration order (base first) — the single fan-out point every poll routes
   * through, so the live-`/stream` publish and the cutover cascade run off the
   * one observed candle.
   */
  private emit(event: CandleEvent): void {
    this.options.onCandle(event);
    for (const listener of this.extraListeners) {
      listener(event);
    }
  }
}

/**
 * The {@link SchedulerRegistry} timeout name for a period.
 */
function timeoutName(period: Period): string {
  return `${TIMEOUT_PREFIX}${period}`;
}
