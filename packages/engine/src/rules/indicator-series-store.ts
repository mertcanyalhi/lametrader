import {
  type Candle,
  type IndicatorStatePoint,
  type Period,
  type StateValue,
  StateValueType,
} from '@lametrader/core';

import type { IndicatorService } from '../indicators/indicator-service.js';
import type { SeriesPoint, SeriesView } from './series.types.js';

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
 * Holds the **full** computed series per `(instanceId, stateKey)` in append
 * order so v2 series-aware operators (Crossing, Channel, Moving) can walk
 * backward through the indicator's timeline.
 */
export class IndicatorSeriesStore {
  /** Keyed by `instanceId`; each value tracks the instance config + per-key series. */
  private readonly instances = new Map<string, InstanceEntry>();

  constructor(private readonly indicatorService: IndicatorService) {}

  /**
   * Compute the instance's full series over the existing candle history and
   * cache it under `instanceId`. Re-warming an existing id replaces its series.
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
    this.instances.set(request.instanceId, {
      config: request,
      seriesByKey,
    });
  }

  /**
   * The most recent value for `(instanceId, stateKey)`, or `null` when the
   * instance is unknown, the key isn't projected, or the series is empty /
   * the latest row's value is `null` (warm-up).
   */
  latest(instanceId: string, stateKey: string): StateValue | null {
    const series = this.instances.get(instanceId)?.seriesByKey.get(stateKey);
    if (!series || series.length === 0) return null;
    return series[series.length - 1]?.value ?? null;
  }

  /**
   * The full series view for `(instanceId, stateKey)`. Returns an empty view
   * when the instance is unknown or the key isn't projected — operators
   * read `length === 0` and treat the operand as "no data yet" rather than
   * crashing.
   */
  series(instanceId: string, stateKey: string): SeriesView {
    const series = this.instances.get(instanceId)?.seriesByKey.get(stateKey) ?? [];
    return new ArraySeriesView(series);
  }

  /**
   * Recompute the instance for the just-arrived bar and append the resulting
   * state row to every projected key. No-op when the instance is unknown.
   *
   * The recompute happens against the indicator service so the same
   * warmup-aware logic is used (the row at `candle.time` is identical to what
   * a full re-warmup would produce, given the candle is already persisted).
   */
  async onBar(instanceId: string, candle: Candle): Promise<void> {
    const entry = this.instances.get(instanceId);
    if (!entry) return;
    const result = await this.indicatorService.compute(
      entry.config.symbolId,
      entry.config.indicatorKey,
      entry.config.inputs,
      entry.config.period,
      { from: candle.time, to: candle.time + 1 },
    );
    const row = result.state.find((point) => point.time === candle.time);
    if (!row) return;
    appendRow(entry.seriesByKey, row);
  }
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
 * v2 indicator state-fields the rules engine reads are numeric today (SMA,
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
