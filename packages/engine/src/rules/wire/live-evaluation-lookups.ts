import {
  type StateRepository,
  StateScope,
  type StateValue,
  StateValueType,
} from '@lametrader/core';

import type { CandleEvent } from '../../candles/polling-service.types.js';
import type { BarAxis } from '../bar-series-view.js';
import { ArraySeriesView } from '../indicator-series-store.js';
import type { SeriesPoint, SeriesView } from '../series.types.js';
import type { EvaluationLookups } from './live-evaluation-lookups.types.js';

/**
 * One per-symbol OHLCV snapshot derived from the latest observed bar.
 *
 * Updated by {@link LiveEvaluationLookups.recordCandle} on every inbound
 * {@link CandleEvent}; read by the {@link ActionRunner} when snapshotting the
 * `Fired.context.lookupSnapshot` payload.
 */
interface OhlcvSnapshot {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Live, synchronous adapter over the v1 {@link EvaluationLookups} interface
 * that the {@link ActionRunner} consumes for `Fired.context.lookupSnapshot`
 * payloads.
 *
 * Hold the minimum live state needed to satisfy a sync read at fire time:
 *
 * - Per-symbol latest tick price (fed by {@link recordQuote}).
 * - Per-symbol latest OHLCV (fed by {@link recordCandle}).
 * - Indicator-instance state (`(instanceId, stateKey)`), mirrored via
 *   {@link recordIndicatorState}.
 * - State repository proxy for symbol / global state reads (the repo
 *   exposes only async getters; the lookups maintains a synchronous mirror
 *   subscribed to `onStateChanged` so the snapshot path stays sync).
 *
 * Lazy: ceiling is "the most recent single value observed per slot".
 * Upgrade path: when series-aware operators need a real history at evaluation
 * time, the orchestrator pre-warms a `BarSeriesView` per `(symbolId, period)`
 * + an `IndicatorSeriesStore` — both already exist; the wire just hands them
 * to the context builder. The lookups here only need a single point because
 * the v1 ActionRunner's snapshot consumes one scalar per axis.
 */
export class LiveEvaluationLookups implements EvaluationLookups {
  /** symbolId → latest tick price. */
  private readonly tickPrice = new Map<string, number>();
  /** symbolId → latest OHLCV bar snapshot. */
  private readonly ohlcv = new Map<string, OhlcvSnapshot>();
  /** instanceId|stateKey → latest indicator state value. */
  private readonly indicatorState = new Map<string, StateValue>();
  /** profileId|symbolId|key → latest symbol-state value. */
  private readonly symbolState = new Map<string, StateValue>();
  /** profileId|key → latest global-state value. */
  private readonly globalState = new Map<string, StateValue>();

  /**
   * @param state - state repository; subscribed to so the sync mirror tracks
   *   every mutation the orchestrator's action runner makes.
   */
  constructor(state: StateRepository) {
    state.onStateChanged((event) => {
      if (event.scope.kind === StateScope.Symbol) {
        const key = symbolStateKey(event.profileId, event.scope.symbolId, event.key);
        if (event.current === null) this.symbolState.delete(key);
        else this.symbolState.set(key, event.current);
        return;
      }
      const key = globalStateKey(event.profileId, event.key);
      if (event.current === null) this.globalState.delete(key);
      else this.globalState.set(key, event.current);
    });
  }

  /**
   * Update the per-symbol tick price from an inbound quote — called by the
   * orchestrator's tick path before dispatch.
   */
  recordQuote(symbolId: string, price: number): void {
    this.tickPrice.set(symbolId, price);
  }

  /**
   * Update the per-symbol OHLCV snapshot from an inbound candle — called by
   * the orchestrator's bar path before dispatch.
   *
   * FX candles don't carry `volume` — the snapshot's volume axis stays at 0
   * (operators that read `Volume` on an FX symbol see "no data yet" rather
   * than crashing).
   */
  recordCandle(event: CandleEvent): void {
    const candle = event.candle as {
      open: number;
      high: number;
      low: number;
      close: number;
      volume?: number;
    };
    this.ohlcv.set(event.id, {
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume ?? 0,
    });
  }

  /**
   * Build a one-axis `SeriesView` map keyed by axis (`barSeriesKey(axis)`)
   * over the latest OHLCV snapshot for `symbolId`, suitable for handing to
   * `buildEvaluationContext`'s `barSeries`.
   *
   * Lazy: each view holds one point — the snapshot's value at `ts === 0`.
   * Comparison / equality operators only need `asOf(MAX_SAFE_INTEGER) →
   * latest`; that resolves to the snapshot. Series-aware operators on bar
   * axes (Crossing, Channel, Moving) need a real history and would observe
   * an empty walk past the single point — they're not part of this slice
   * (see spec "Out of scope").
   */
  bookSeriesFor(symbolId: string): Map<string, SeriesView> {
    const snap = this.ohlcv.get(symbolId);
    const out = new Map<string, SeriesView>();
    if (snap === undefined) return out;
    const axes: BarAxis[] = ['open', 'high', 'low', 'close', 'volume'];
    for (const axis of axes) {
      const value = snap[axis];
      const point: SeriesPoint = {
        ts: 0,
        value: { type: StateValueType.Number, value },
      };
      out.set(axis, new ArraySeriesView([point]));
    }
    return out;
  }

  /**
   * Update an indicator-instance state value — wired to the same upstream the
   * v2 indicator cascade bridge listens on, so this mirror stays consistent
   * with the cascade events the dispatcher observes.
   */
  recordIndicatorState(instanceId: string, stateKey: string, value: StateValue): void {
    this.indicatorState.set(indicatorKey(instanceId, stateKey), value);
  }

  getCurrentValue(symbolId: string): number | null {
    return this.tickPrice.get(symbolId) ?? null;
  }
  getOpenValue(symbolId: string): number | null {
    return this.ohlcv.get(symbolId)?.open ?? null;
  }
  getHighValue(symbolId: string): number | null {
    return this.ohlcv.get(symbolId)?.high ?? null;
  }
  getLowValue(symbolId: string): number | null {
    return this.ohlcv.get(symbolId)?.low ?? null;
  }
  getCloseValue(symbolId: string): number | null {
    return this.ohlcv.get(symbolId)?.close ?? null;
  }
  getVolumeValue(symbolId: string): number | null {
    return this.ohlcv.get(symbolId)?.volume ?? null;
  }
  getIndicatorValue(instanceId: string, stateKey: string): StateValue | null {
    return this.indicatorState.get(indicatorKey(instanceId, stateKey)) ?? null;
  }
  getSymbolState(profileId: string, symbolId: string, key: string): StateValue | null {
    return this.symbolState.get(symbolStateKey(profileId, symbolId, key)) ?? null;
  }
  getGlobalState(profileId: string, key: string): StateValue | null {
    return this.globalState.get(globalStateKey(profileId, key)) ?? null;
  }

  /**
   * Warm the sync state mirror from the persisted repository on startup —
   * without this, rules reading state slots set by a previous engine process
   * see `null` until that slot is mutated again in this one (#432).
   *
   * Invoked by {@link wireRuleEngine} after construction with a snapshot
   * built from `rules.list()` × `watchlist.list()` over `listSymbolState` /
   * `listGlobalState`; that wire-up is the only call site today.
   */
  warmInitialState(snapshot: ReadonlyArray<InitialStateEntry>): void {
    for (const entry of snapshot) {
      if (entry.scope === 'symbol') {
        this.symbolState.set(
          symbolStateKey(entry.profileId, entry.symbolId, entry.key),
          entry.value,
        );
      } else {
        this.globalState.set(globalStateKey(entry.profileId, entry.key), entry.value);
      }
    }
  }
}

/** One entry consumed by {@link LiveEvaluationLookups.warmInitialState}. */
export type InitialStateEntry =
  | { scope: 'symbol'; profileId: string; symbolId: string; key: string; value: StateValue }
  | { scope: 'global'; profileId: string; key: string; value: StateValue };

function symbolStateKey(profileId: string, symbolId: string, key: string): string {
  return `${profileId}|${symbolId}|${key}`;
}

function globalStateKey(profileId: string, key: string): string {
  return `${profileId}|${key}`;
}

function indicatorKey(instanceId: string, stateKey: string): string {
  return `${instanceId}|${stateKey}`;
}
