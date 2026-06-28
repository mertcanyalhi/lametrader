import {
  type BackfillRange,
  type CandleRepository,
  type IndicatorComputeResult,
  IndicatorError,
  type IndicatorModule,
  IndicatorNotFoundError,
  type IndicatorStateEvent,
  type IndicatorStateListener,
  type IndicatorStatePoint,
  type Period,
  SymbolNotFoundError,
  validateIndicatorInputs,
  type WatchedSymbol,
  type WatchlistRepository,
} from '@lametrader/core';
import { nanoid } from 'nanoid';

import type { CandleEvent } from '../candles/polling-service.types.js';
import type { IndicatorRegistry } from './indicator-registry.js';

/**
 * The persisted shape of one live-stream subscription. Lives in-process — the
 * subscription map is non-durable.
 */
interface Subscription {
  /** Generated id for routing emitted events. */
  subscriptionId: string;
  /** Canonical symbol id this subscription watches. */
  symbolId: string;
  /** Period the subscription is keyed on. */
  period: Period;
  /** Indicator definition key (looked up on each candle event). */
  indicatorKey: string;
  /** Validated input values passed to the indicator's `compute`. */
  inputs: Record<string, unknown>;
}

/**
 * The validated input a caller passes to {@link IndicatorService.subscribe}.
 *
 * `inputs` is raw at the boundary; the service validates against the
 * indicator's descriptors before storing.
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
 * Options for {@link IndicatorService}: the state sink and id generator.
 */
export interface IndicatorServiceOptions {
  /** Where each emitted {@link IndicatorStateEvent} is delivered. */
  onState?: IndicatorStateListener;
  /** Generate a new subscription id; defaults to nanoid. */
  newId?: () => string;
}

/** Output of the shared validator — symbol, module, and validated inputs. */
interface ValidatedRequest {
  symbol: WatchedSymbol;
  module: IndicatorModule;
  inputs: Record<string, unknown>;
}

/**
 * Application use-case for indicators — both ad-hoc compute (request /
 * pass-through) and live streaming (subscribe / push on candle events).
 *
 * Two surfaces, one service: validation, registry lookup, asset-class check,
 * and input validation are identical for both paths, so they live here once.
 *
 * Request-driven compute is computed **on read** (no persistence) over
 * **confirmed/historical** candles. Live streaming is pushed via `onState`
 * (transport-agnostic per ADR-0005); the API renders to WebSocket frames.
 */
export class IndicatorService {
  /** Active subscriptions keyed by subscription id. */
  private readonly subscriptions = new Map<string, Subscription>();
  /** Where each emitted event is delivered. */
  private readonly onState: IndicatorStateListener;
  /** Subscription id generator (injectable; defaults to nanoid). */
  private readonly newId: () => string;

  constructor(
    private readonly indicators: IndicatorRegistry,
    private readonly watchlist: WatchlistRepository,
    private readonly candles: CandleRepository,
    options: IndicatorServiceOptions = {},
  ) {
    this.onState = options.onState ?? (() => {});
    this.newId = options.newId ?? (() => nanoid());
  }

  /**
   * Compute an indicator over a symbol+period's stored candles for an explicit
   * (or open-ended) range. Generic surface used by HTTP, CLI, and the live
   * stream path (via {@link recomputeForBar}).
   *
   * Loads the `[range.from, range.to)` candles plus the warm-up bars (the N
   * candles ending just before `range.from`, by count) so the sub-range's
   * first row is already past warm-up; the result is then sliced to
   * `[range.from, range.to)`.
   *
   * @throws {@link SymbolNotFoundError} when the symbol is not watched.
   * @throws {@link IndicatorNotFoundError} when the indicator key is not registered.
   * @throws {@link IndicatorError} on asset-class mismatch or invalid `inputs`.
   */
  async compute(
    symbolId: string,
    indicatorKey: string,
    inputs: Record<string, unknown>,
    period: Period,
    range?: Partial<BackfillRange>,
  ): Promise<IndicatorComputeResult> {
    const { module, inputs: validated } = await this.validateRequest(
      symbolId,
      indicatorKey,
      inputs,
    );
    const to = range?.to ?? Number.MAX_SAFE_INTEGER;
    const from = range?.from ?? 0;
    const warmupBars = module.warmup
      ? module.warmup(validated as Parameters<NonNullable<typeof module.warmup>>[0])
      : 0;
    const warmup =
      warmupBars > 0
        ? (await this.candles.latestN(symbolId, period, warmupBars, from)).reverse()
        : [];
    const inRange = await this.candles.range(symbolId, period, from, to);
    const series = module.compute(validated as Parameters<typeof module.compute>[0], [
      ...warmup,
      ...inRange,
    ]);
    const state: IndicatorStatePoint[] = series.filter(
      (row) => row.time >= from && row.time < to,
    ) as IndicatorStatePoint[];
    return {
      indicatorKey,
      version: module.definition.version,
      period,
      state,
    };
  }

  /**
   * Register a live subscription. Runs the same validation as {@link compute}
   * (without loading candles). Returns the generated `subscriptionId`.
   */
  async subscribe(input: IndicatorSubscribeInput): Promise<string> {
    const { inputs: validated } = await this.validateRequest(
      input.id,
      input.indicatorKey,
      input.inputs,
    );
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

  /** Drop a subscription by id. Idempotent — unknown ids are a no-op. */
  unsubscribe(subscriptionId: string): void {
    this.subscriptions.delete(subscriptionId);
  }

  /**
   * React to a candle event from the polling loop. For each subscription
   * matching `(event.id, event.period)`, recompute via
   * {@link recomputeForBar} and emit one event.
   */
  async handleCandle(event: CandleEvent): Promise<void> {
    for (const subscription of this.subscriptions.values()) {
      if (subscription.symbolId !== event.id || subscription.period !== event.period) continue;
      const stateEvent = await this.recomputeForBar(subscription, event.candle.time, event.final);
      if (stateEvent) {
        this.onState(stateEvent);
      }
    }
  }

  /**
   * Validate a request: symbol watched, indicator known, asset-class compatible,
   * inputs valid. Returns the resolved symbol + module + validated inputs;
   * throws the three known errors otherwise.
   *
   * One private helper replaces two identical inline blocks that previously
   * lived in `IndicatorComputeService.compute` and `IndicatorStreamService.subscribe`.
   */
  private async validateRequest(
    symbolId: string,
    indicatorKey: string,
    inputs: Record<string, unknown>,
  ): Promise<ValidatedRequest> {
    const symbol = await this.watchlist.get(symbolId);
    if (!symbol) {
      throw new SymbolNotFoundError(`symbol not watched: ${symbolId}`);
    }
    const module = this.indicators.get(indicatorKey);
    if (!module) {
      throw new IndicatorNotFoundError(`indicator not found: ${indicatorKey}`);
    }
    if (!module.definition.appliesTo.includes(symbol.type)) {
      throw new IndicatorError(
        `indicator "${indicatorKey}" does not apply to ${symbol.type} symbols`,
      );
    }
    const validated = validateIndicatorInputs(module.definition, inputs);
    return { symbol, module, inputs: validated };
  }

  /**
   * Recompute one subscription's indicator at `time` and project the state row
   * at that bar. Internally calls `compute(..., {from: time, to: time + 1})` —
   * the single-bar window that previously lived as a magic literal in the
   * stream path now has a name and a docstring.
   *
   * Returns `null` when the row isn't found — unreachable when the polling
   * loop has just stored the candle, but a defensive guard.
   */
  private async recomputeForBar(
    subscription: Subscription,
    time: number,
    final: boolean,
  ): Promise<IndicatorStateEvent | null> {
    const result = await this.compute(
      subscription.symbolId,
      subscription.indicatorKey,
      subscription.inputs,
      subscription.period,
      { from: time, to: time + 1 },
    );
    const row = result.state.find((point) => point.time === time);
    if (!row) return null;
    return {
      subscriptionId: subscription.subscriptionId,
      id: subscription.symbolId,
      period: subscription.period,
      indicatorKey: subscription.indicatorKey,
      state: row,
      final,
    };
  }
}
