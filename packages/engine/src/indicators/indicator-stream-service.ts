import {
  IndicatorError,
  IndicatorNotFoundError,
  type IndicatorStateEvent,
  type IndicatorStateListener,
  type Period,
  SymbolNotFoundError,
  validateIndicatorInputs,
  type WatchlistRepository,
} from '@lametrader/core';
import { nanoid } from 'nanoid';
import type { CandleEvent } from '../candles/polling-service.types.js';
import type { IndicatorComputeService } from './indicator-compute-service.js';
import type { IndicatorRegistry } from './indicator-registry.js';

/**
 * The persisted shape of one live-stream subscription.
 *
 * Lives in-process — the subscription map is non-durable (same boundary as `BackfillJobService` and `CandleStreamHub`).
 */
interface Subscription {
  /** Generated id for routing emitted events. */
  subscriptionId: string;
  /** Canonical symbol id this subscription watches. */
  symbolId: string;
  /** Period the subscription is keyed on (matches candle events with this period). */
  period: Period;
  /** Indicator definition key (looked up in the registry on each candle event). */
  indicatorKey: string;
  /** Validated input values passed to the indicator's `compute`. */
  inputs: Record<string, unknown>;
}

/**
 * The validated input a caller passes to `subscribe`.
 *
 * `inputs` is raw at the boundary; the service validates it against the indicator's descriptors before storing.
 */
export interface IndicatorSubscribeInput {
  /** Canonical symbol id to watch. */
  id: string;
  /** Period to subscribe at. */
  period: Period;
  /** Which indicator (registry key). */
  indicatorKey: string;
  /** Raw input values for the indicator. */
  inputs: Record<string, unknown>;
}

/**
 * Options for {@link IndicatorStreamService}: the state sink and injectable id generator (defaulted for production).
 */
export interface IndicatorStreamServiceOptions {
  /** Where each emitted {@link IndicatorStateEvent} is delivered (driving adapters render it). */
  onState?: IndicatorStateListener;
  /** Generate a new subscription id; defaults to nanoid. */
  newId?: () => string;
}

/**
 * Application use-case for live indicator streaming.
 *
 * Maintains an in-process registry of subscriptions and reacts to {@link CandleEvent}s from the polling loop: for every subscription matching `(symbolId, period)`, recompute the indicator via the supplied {@link IndicatorComputeService} and emit one {@link IndicatorStateEvent} carrying the row at the just-arrived candle's `time`.
 *
 * Transport-agnostic per ADR-0005 — emission happens via the `onState` callback; the API renders it to WebSocket frames.
 */
export class IndicatorStreamService {
  /** Active subscriptions keyed by subscription id. */
  private readonly subscriptions = new Map<string, Subscription>();
  /** Where each emitted event is delivered. */
  private readonly onState: IndicatorStateListener;
  /** Subscription id generator (injectable; defaults to nanoid). */
  private readonly newId: () => string;

  /**
   * @param indicators - the indicator registry (looked up at subscribe time).
   * @param watchlist - the watchlist (a symbol must be watched to be subscribable).
   * @param compute - the compute use-case (invoked on each candle event for matching subscriptions).
   * @param options - injectable state sink and id generator.
   */
  constructor(
    private readonly indicators: IndicatorRegistry,
    private readonly watchlist: WatchlistRepository,
    private readonly compute: IndicatorComputeService,
    options: IndicatorStreamServiceOptions = {},
  ) {
    this.onState = options.onState ?? (() => {});
    this.newId = options.newId ?? (() => nanoid());
  }

  /**
   * Register a live subscription.
   *
   * Runs the same checks `IndicatorComputeService.compute` does at request time, **without loading candles** — a valid subscribe is one whose subsequent `compute` would also be valid.
   *
   * @returns the generated `subscriptionId` used to address this subscription.
   * @throws {@link SymbolNotFoundError} when the symbol is not on the watchlist.
   * @throws {@link IndicatorNotFoundError} when the indicator key is not registered.
   * @throws {@link IndicatorError} on asset-class mismatch or invalid `inputs`.
   */
  async subscribe(input: IndicatorSubscribeInput): Promise<string> {
    const symbol = await this.watchlist.get(input.id);
    if (!symbol) {
      throw new SymbolNotFoundError(`symbol not watched: ${input.id}`);
    }
    const module = this.indicators.get(input.indicatorKey);
    if (!module) {
      throw new IndicatorNotFoundError(`indicator not found: ${input.indicatorKey}`);
    }
    if (!module.definition.appliesTo.includes(symbol.type)) {
      throw new IndicatorError(
        `indicator "${input.indicatorKey}" does not apply to ${symbol.type} symbols`,
      );
    }
    const validated = validateIndicatorInputs(module.definition, input.inputs);
    const subscriptionId = this.newId();
    this.subscriptions.set(subscriptionId, {
      subscriptionId,
      symbolId: input.id,
      period: input.period,
      indicatorKey: input.indicatorKey,
      inputs: validated,
    });
    return subscriptionId;
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
   * For each subscription matching `(event.id, event.period)`, recompute the indicator and emit the row at the candle's `time` via the `onState` callback.
   */
  async handleCandle(event: CandleEvent): Promise<void> {
    for (const subscription of this.subscriptions.values()) {
      if (subscription.symbolId !== event.id || subscription.period !== event.period) continue;
      const stateEvent = await this.computeStateEvent(subscription, event);
      if (stateEvent) {
        this.onState(stateEvent);
      }
    }
  }

  /**
   * Run the compute for one subscription against the just-arrived candle and project the state row at the candle's `time`.
   *
   * Returns `null` (and emits nothing) when the row isn't found in the result — unreachable when the polling loop has just stored the candle, but a defensive guard against a bogus frame.
   */
  private async computeStateEvent(
    subscription: Subscription,
    event: CandleEvent,
  ): Promise<IndicatorStateEvent | null> {
    const result = await this.compute.compute(
      subscription.symbolId,
      subscription.indicatorKey,
      subscription.inputs,
      subscription.period,
    );
    const row = result.state.find((point) => point.time === event.candle.time);
    if (!row) return null;
    return {
      subscriptionId: subscription.subscriptionId,
      id: subscription.symbolId,
      period: subscription.period,
      indicatorKey: subscription.indicatorKey,
      state: row,
      final: event.final,
    };
  }
}
