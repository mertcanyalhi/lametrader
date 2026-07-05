import {
  type Candle,
  type IndicatorStatePoint,
  type Period,
  type StateValue,
  StateValueType,
} from '@lametrader/core';
import type { IndicatorService } from '../indicators/indicator.service.js';
import { getLogger } from './engine-log.js';
import type { SeriesPoint, SeriesView } from './series.types.js';

/**
 * Scope-bound logger for the store's live recompute.
 *
 * Sits under `engine.rules.wire` alongside the startup warm-up so a single
 * `engine.rules.*:trace` setting enables every rules-engine surface (per #436).
 */
const log = getLogger('engine.rules.wire');

/**
 * Snapshot used to warm up one indicator-instance series at startup.
 *
 * Mirrors the shape `IndicatorService.compute` already validates — the store
 * delegates the heavy lifting (registry lookup, asset-class check, input
 * validation, warmup loading) so duplication stays at zero.
 */
export interface IndicatorWarmupRequest {
  /** Profile-attached instance id; the routing key for {@link latest} / {@link onBar}. */
  instanceId: string;
  /** Canonical symbol id this instance is bound to. */
  symbolId: string;
  /** Bar period the instance is computed on. */
  period: Period;
  /** Indicator registry key (e.g. `'sma'`). */
  indicatorKey: string;
  /** Raw input values for the indicator, passed straight to `compute`. */
  inputs: Record<string, unknown>;
}

/**
 * In-memory store of indicator-instance series.
 *
 * Per ADR 0016 pillar 4: indicator output is recomputed from the persisted
 * candle history on startup, then maintained in-memory only — ephemeral by
 * design.
 *
 * Holds the **full** computed series per `(symbolId, period, instanceId, stateKey)`
 * slot in append order so series-aware operators (Crossing, Channel, Moving) can
 * walk backward through the indicator's timeline.
 *
 * The slot key includes the symbol and period because one profile-attached
 * instance is computed for **every** symbol its profile applies to, across each
 * symbol's watched periods (the attach spec stores no period on the instance).
 * An `IndicatorRef` operand disambiguates by the firing symbol (ADR 0016) and the
 * leaf's `interval` — so the store keys by the same compound slot the
 * {@link import('./bridges/indicator-cascade-bridge.js').IndicatorCascadeBridge}
 * already uses, never by `instanceId` alone (which would collapse every
 * symbol/period of one instance onto a single series).
 */
export class IndicatorSeriesStore {
  /** Keyed by {@link slotKey}; each value tracks the instance config + per-key series. */
  private readonly slots = new Map<string, InstanceEntry>();

  constructor(private readonly indicatorService: IndicatorService) {}

  /**
   * Compute the instance's full series over the existing candle history and
   * cache it under its `(symbolId, period, instanceId)` slot. Re-warming an
   * existing slot replaces its series.
   *
   * Delegates the validation + compute to {@link IndicatorService.compute}
   * with an open-ended window so every stored candle contributes.
   */
  async warmup(request: IndicatorWarmupRequest): Promise<void> {
    const result = await this.indicatorService.compute(
      request.symbolId,
      request.indicatorKey,
      request.inputs,
      request.period,
    );
    const seriesByKey = projectStateRows(result.state);
    this.slots.set(slotKey(request.symbolId, request.period, request.instanceId), {
      config: request,
      seriesByKey,
    });
  }

  /**
   * The most recent value for the `(symbolId, period, instanceId, stateKey)`
   * slot, or `null` when the slot is unknown, the key isn't projected, or the
   * series is empty / the latest row's value is `null` (warm-up).
   */
  latest(
    symbolId: string,
    period: Period,
    instanceId: string,
    stateKey: string,
  ): StateValue | null {
    const series = this.slots.get(slotKey(symbolId, period, instanceId))?.seriesByKey.get(stateKey);
    if (!series || series.length === 0) return null;
    return series[series.length - 1]?.value ?? null;
  }

  /**
   * The full series view for the `(symbolId, period, instanceId, stateKey)`
   * slot. Returns an empty view when the slot is unknown or the key isn't
   * projected — operators read `length === 0` and treat the operand as "no data
   * yet" rather than crashing.
   */
  series(symbolId: string, period: Period, instanceId: string, stateKey: string): SeriesView {
    const series =
      this.slots.get(slotKey(symbolId, period, instanceId))?.seriesByKey.get(stateKey) ?? [];
    return new ArraySeriesView(series);
  }

  /**
   * Recompute every instance warmed at `(symbolId, period)` for the just-arrived
   * bar and append each resulting state row to its projected keys. No-op for a
   * `(symbolId, period)` with no warmed instances.
   *
   * Driven by symbol+period (not instanceId) because the candle feed knows the
   * bar's symbol and period but not which instances are attached — the store
   * fans the one bar out to every slot that shares it.
   *
   * The recompute happens against the indicator service so the same
   * warmup-aware logic is used (the row at `candle.time` is identical to what a
   * full re-warmup would produce, given the candle is already persisted).
   *
   * A single instance's recompute failure is isolated (logged + skipped, the
   * slot keeps its prior series) so it can never reject the caller — the bar
   * feed runs this inside the serialized rule step, where a throw would silently
   * drop the whole bar's evaluation (the serializer swallows a rejected step).
   */
  async onBar(symbolId: string, period: Period, candle: Candle): Promise<void> {
    for (const entry of this.slots.values()) {
      if (entry.config.symbolId !== symbolId || entry.config.period !== period) continue;
      try {
        const result = await this.indicatorService.compute(
          entry.config.symbolId,
          entry.config.indicatorKey,
          entry.config.inputs,
          entry.config.period,
          { from: candle.time, to: candle.time + 1 },
        );
        const row = result.state.find((point) => point.time === candle.time);
        if (!row) continue;
        appendRow(entry.seriesByKey, row);
      } catch (error) {
        log.debug(
          {
            instanceId: entry.config.instanceId,
            symbolId,
            period,
            time: candle.time,
            reason: error instanceof Error ? error.message : String(error),
          },
          'indicator_onbar_recompute_failed',
        );
      }
    }
  }
}

/**
 * Build the compound slot key for one indicator-instance series.
 *
 * Mirrors the `IndicatorCascadeBridge`'s `${symbolId}|${period}|${instanceId}`
 * slot so the store the evaluator reads is keyed identically to the cascade
 * dedup cache.
 */
function slotKey(symbolId: string, period: Period, instanceId: string): string {
  return `${symbolId}|${period}|${instanceId}`;
}

/**
 * Per-instance state held by the store: config (for re-compute) + the
 * projected series per state-key.
 */
interface InstanceEntry {
  /** Original warmup request — preserved so {@link IndicatorSeriesStore.onBar} reuses inputs. */
  config: IndicatorWarmupRequest;
  /** Series per `stateKey`, ascending by `ts`. */
  seriesByKey: Map<string, SeriesPoint[]>;
}

/**
 * A {@link SeriesView} over a pre-built array of points (ascending `ts`).
 *
 * Used internally by {@link IndicatorSeriesStore.series} and by the literal /
 * symbol-state operands resolved through `EvaluationContext`.
 */
export class ArraySeriesView implements SeriesView {
  constructor(private readonly points: readonly SeriesPoint[]) {}

  get length(): number {
    return this.points.length;
  }

  *backwardWalk(): IterableIterator<SeriesPoint> {
    for (let i = this.points.length - 1; i >= 0; i -= 1) {
      const point = this.points[i];
      if (point !== undefined) yield point;
    }
  }

  asOf(queryTs: number): SeriesPoint | null {
    for (const point of this.backwardWalk()) {
      if (point.ts <= queryTs) return point;
    }
    return null;
  }
}

/**
 * Project the compute result's `IndicatorStatePoint[]` (a list of `{time, ...keys}`
 * rows) into one ascending-`ts` series per state key.
 *
 * Drops rows where the key's value is `null` (warm-up) or non-numeric so the
 * series stays a clean `StateValue` projection.
 */
function projectStateRows(rows: IndicatorStatePoint[]): Map<string, SeriesPoint[]> {
  const out = new Map<string, SeriesPoint[]>();
  for (const row of rows) {
    for (const [key, raw] of Object.entries(row)) {
      if (key === 'time') continue;
      const value = toStateValue(raw);
      if (!value) continue;
      let series = out.get(key);
      if (!series) {
        series = [];
        out.set(key, series);
      }
      series.push({ ts: row.time, value });
    }
  }
  return out;
}

/**
 * Append one fresh indicator row to the existing per-key series.
 *
 * Only mutates keys whose value resolved to a {@link StateValue} — warm-up
 * rows (`null`) are silently ignored.
 */
function appendRow(seriesByKey: Map<string, SeriesPoint[]>, row: IndicatorStatePoint): void {
  for (const [key, raw] of Object.entries(row)) {
    if (key === 'time') continue;
    const value = toStateValue(raw);
    if (!value) continue;
    let series = seriesByKey.get(key);
    if (!series) {
      series = [];
      seriesByKey.set(key, series);
    }
    series.push({ ts: row.time, value });
  }
}

/**
 * Wrap an indicator state-field value as a {@link StateValue}.
 *
 * Indicator state-fields the rules engine reads are numeric today (SMA,
 * VWMA, …); a future bool/enum field would extend this match.
 * Returns `null` for `null` (warm-up) and for shapes we don't yet project.
 */
function toStateValue(raw: unknown): StateValue | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return { type: StateValueType.Number, value: raw };
  }
  return null;
}
