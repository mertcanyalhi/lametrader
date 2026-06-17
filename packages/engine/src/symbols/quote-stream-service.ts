import {
  type Candle,
  type CandleRepository,
  computeQuote,
  type Period,
  SymbolError,
  SymbolNotFoundError,
  type SymbolQuoteListener,
  type WatchlistRepository,
} from '@lametrader/core';
import { nanoid } from 'nanoid';
import type { CandleEvent } from '../candles/polling-service.types.js';
import type { ConfigService } from '../config/config-service.js';

/**
 * The persisted shape of one live quote subscription.
 *
 * Lives in-process — the subscription map is non-durable (same boundary as the indicator stream service).
 */
interface QuoteSubscription {
  /** Generated id for routing emitted events. */
  subscriptionId: string;
  /** Canonical symbol id this subscription watches. */
  symbolId: string;
  /** The `defaultPeriod` captured at subscribe time (the only period quoted). */
  period: Period;
  /**
   * The rolling previous (closed) bar; its `close` is the baseline `change` is measured against.
   * Rotated to the just-closed candle after a `final: true` frame so subsequent frames measure against it.
   */
  previousBar: Candle;
}

/**
 * The result of a successful {@link QuoteStreamService.subscribe}: the generated id plus the server-resolved period (the config's `defaultPeriod`) the quotes are derived on.
 */
export interface QuoteSubscriptionResult {
  /** Generated id used to address (and later unsubscribe) this subscription. */
  subscriptionId: string;
  /** The period quotes are derived on (the config's `defaultPeriod`). */
  period: Period;
}

/**
 * Options for {@link QuoteStreamService}: the quote sink and injectable id generator (defaulted for production).
 */
export interface QuoteStreamServiceOptions {
  /** Where each emitted {@link SymbolQuoteEvent} is delivered (driving adapters render it). */
  onQuote?: SymbolQuoteListener;
  /** Generate a new subscription id; defaults to nanoid. */
  newId?: () => string;
}

/**
 * Application use-case for live quote streaming — the live counterpart to the `?enrich=true` snapshot (#35).
 *
 * Maintains an in-process registry of per-symbol subscriptions and reacts to {@link CandleEvent}s from the polling loop: for every subscription matching `(symbolId, defaultPeriod)`, re-derive the quote via the pure `computeQuote(eventCandle, previousBar)` and emit one {@link SymbolQuoteEvent}.
 *
 * Holds the rolling previous (closed) bar in each subscription; on a `final: true` candle it rotates that bar to the just-closed candle *after* emitting, so subsequent frames measure change against the new close (the last-bar snap-back, matching the snapshot semantics).
 *
 * Transport-agnostic per ADR-0005 — emission happens via the `onQuote` callback; the API renders it to WebSocket frames.
 */
export class QuoteStreamService {
  /** Active subscriptions keyed by subscription id. */
  private readonly subscriptions = new Map<string, QuoteSubscription>();
  /** Where each emitted event is delivered. */
  private readonly onQuote: SymbolQuoteListener;
  /** Subscription id generator (injectable; defaults to nanoid). */
  private readonly newId: () => string;

  /**
   * @param watchlist - the watchlist (a symbol must be watched to be subscribable).
   * @param config - the configuration use-case (for the `defaultPeriod` quotes are derived on).
   * @param candles - the candle persistence port (read once at subscribe time to seed the baseline).
   * @param options - injectable quote sink and id generator.
   */
  constructor(
    private readonly watchlist: WatchlistRepository,
    private readonly config: ConfigService,
    private readonly candles: CandleRepository,
    options: QuoteStreamServiceOptions = {},
  ) {
    this.onQuote = options.onQuote ?? (() => {});
    this.newId = options.newId ?? (() => nanoid());
  }

  /**
   * Register a live quote subscription on the config's `defaultPeriod`.
   *
   * Applies the same rule as the #35 snapshot: the symbol must be watched, must watch `defaultPeriod`, and must have at least two candles stored there (so a previous-close baseline exists).
   *
   * @returns the generated `subscriptionId` and the resolved `defaultPeriod`.
   * @throws {@link SymbolNotFoundError} when the symbol is not on the watchlist.
   * @throws {@link SymbolError} when the symbol does not watch `defaultPeriod`, or has fewer than two candles there.
   */
  async subscribe(id: string): Promise<QuoteSubscriptionResult> {
    const symbol = await this.watchlist.get(id);
    if (!symbol) {
      throw new SymbolNotFoundError(`symbol not watched: ${id}`);
    }
    const { defaultPeriod } = await this.config.get();
    if (!symbol.periods.includes(defaultPeriod)) {
      throw new SymbolError(`symbol ${id} does not watch the default period ${defaultPeriod}`);
    }
    const [latest, previous] = await this.candles.latestN(id, defaultPeriod, 2);
    if (!latest || !previous) {
      throw new SymbolError(`symbol ${id} has fewer than two ${defaultPeriod} candles to quote`);
    }
    const subscriptionId = this.newId();
    this.subscriptions.set(subscriptionId, {
      subscriptionId,
      symbolId: id,
      period: defaultPeriod,
      previousBar: previous,
    });
    return { subscriptionId, period: defaultPeriod };
  }

  /**
   * Drop a subscription by id.
   *
   * Idempotent — unknown ids are a no-op.
   */
  unsubscribe(subscriptionId: string): void {
    this.subscriptions.delete(subscriptionId);
  }

  /**
   * React to a candle event from the polling loop.
   *
   * For each subscription matching `(event.id, event.period)`, derive the quote at the candle via `computeQuote` and emit it; then, if the candle is `final`, rotate the subscription's previous bar to it so later frames measure against the just-closed close.
   */
  handleCandle(event: CandleEvent): void {
    for (const subscription of this.subscriptions.values()) {
      if (subscription.symbolId !== event.id || subscription.period !== event.period) continue;
      this.onQuote({
        subscriptionId: subscription.subscriptionId,
        id: subscription.symbolId,
        period: subscription.period,
        quote: computeQuote(event.candle, subscription.previousBar),
        final: event.final,
      });
      if (event.final) {
        subscription.previousBar = event.candle;
      }
    }
  }
}
