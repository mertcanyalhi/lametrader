import type {
  BackfillRange,
  IndicatorComputeResult,
  IndicatorInstance,
  IndicatorStatePoint,
  Period,
} from '@lametrader/core';

import type { SeriesSample, SeriesView } from './series.types.js';

/**
 * Function the {@link IndicatorSeriesStore} delegates compute to — same shape
 * as `IndicatorService.compute` (per ADR 0016: rebuild from bars via the
 * existing service, no duplicate persistence).
 *
 * Injected so the unit tier can drive the store with a small fake while the
 * integration tier wires the real service.
 */
export type IndicatorComputeFn = (
  symbolId: string,
  indicatorKey: string,
  inputs: Record<string, unknown>,
  period: Period,
  range?: Partial<BackfillRange>,
) => Promise<IndicatorComputeResult>;

/**
 * In-memory cache of per-`(symbolId, period, instanceId, stateKey)`
 * numeric series, rebuilt from the candle history via the injected
 * {@link IndicatorComputeFn}.
 *
 * Per ADR 0016: indicator series are kept in-memory and recomputed from bars
 * on startup; only numeric state-keys back a {@link SeriesView}.
 * Non-numeric state-keys (Bool / Enum) are addressable through
 * {@link EvaluationContext.resolveLatest} but never via series.
 */
export class IndicatorSeriesStore {
  /** Series keyed by `${symbolId}|${period}|${instanceId}|${stateKey}`. */
  private readonly cache = new Map<string, IndicatorSeriesView>();

  constructor(private readonly compute: IndicatorComputeFn) {}

  /**
   * Load the full history for `instance` over `[range.from, range.to)` (or
   * the indicator's natural history when omitted) via the injected compute
   * function, replacing any cached series for the
   * `(symbolId, period, instanceId, *)` triple.
   *
   * Numeric state-keys produce one cached series each; non-numeric values
   * are silently dropped (they're not series-eligible).
   */
  async rebuild(
    symbolId: string,
    period: Period,
    instance: IndicatorInstance,
    range?: Partial<BackfillRange>,
  ): Promise<void> {
    const result = await this.compute(
      symbolId,
      instance.indicatorKey,
      instance.inputs,
      period,
      range,
    );
    const grouped = groupNumericSamples(result.state);
    for (const [stateKey, samples] of grouped) {
      this.cache.set(
        key(symbolId, period, instance.id, stateKey),
        new IndicatorSeriesView(samples),
      );
    }
  }

  /**
   * Recompute a single bar at `ts` and append the resulting numeric samples
   * to each cached series for this instance.
   *
   * Idempotent: a re-append for the same `ts` replaces the previous tail
   * sample so re-polls during the same bar (e.g. forming-bar updates) don't
   * duplicate the row.
   */
  async appendForBar(
    symbolId: string,
    period: Period,
    instance: IndicatorInstance,
    ts: number,
  ): Promise<void> {
    const result = await this.compute(symbolId, instance.indicatorKey, instance.inputs, period, {
      from: ts,
      to: ts + 1,
    });
    const grouped = groupNumericSamples(result.state);
    for (const [stateKey, samples] of grouped) {
      const existing = this.cache.get(key(symbolId, period, instance.id, stateKey));
      const view = existing ?? new IndicatorSeriesView([]);
      view.appendOrReplaceLatest(samples);
      this.cache.set(key(symbolId, period, instance.id, stateKey), view);
    }
  }

  /**
   * The cached series for `(symbolId, period, instanceId, stateKey)`, or
   * `null` when nothing has been rebuilt for that slot (or the state-key
   * isn't numeric).
   */
  seriesFor(
    symbolId: string,
    period: Period,
    instanceId: string,
    stateKey: string,
  ): SeriesView | null {
    return this.cache.get(key(symbolId, period, instanceId, stateKey)) ?? null;
  }
}

/** Mutable {@link SeriesView} backed by an in-memory array. */
class IndicatorSeriesView implements SeriesView {
  constructor(private readonly data: SeriesSample[]) {}

  /**
   * Append `samples` to the end of the buffer; if the leading new sample's
   * `ts` matches an existing trailing sample, the existing one is replaced
   * (idempotent forming-bar re-polls).
   */
  appendOrReplaceLatest(samples: SeriesSample[]): void {
    for (const sample of samples) {
      const last = this.data[this.data.length - 1];
      if (last && last.ts === sample.ts) {
        this.data[this.data.length - 1] = sample;
      } else {
        this.data.push(sample);
      }
    }
  }

  length(): number {
    return this.data.length;
  }

  samples(): readonly SeriesSample[] {
    return this.data;
  }

  latest(): SeriesSample | null {
    return this.data.length === 0 ? null : (this.data[this.data.length - 1] as SeriesSample);
  }

  asOf(asOfTs: number): SeriesSample | null {
    for (let i = this.data.length - 1; i >= 0; i--) {
      const sample = this.data[i] as SeriesSample;
      if (sample.ts <= asOfTs) return sample;
    }
    return null;
  }
}

/** Compose the cache key. */
function key(symbolId: string, period: Period, instanceId: string, stateKey: string): string {
  return `${symbolId}|${period}|${instanceId}|${stateKey}`;
}

/**
 * Walk the indicator state rows and yield one `(stateKey → samples)` map
 * containing only numeric state-keys whose value is a finite number
 * (warm-up `null`s are skipped).
 */
function groupNumericSamples(state: IndicatorStatePoint[]): Map<string, SeriesSample[]> {
  const out = new Map<string, SeriesSample[]>();
  for (const row of state) {
    for (const [stateKey, value] of Object.entries(row)) {
      if (stateKey === 'time') continue;
      if (typeof value !== 'number' || Number.isNaN(value)) continue;
      const list = out.get(stateKey) ?? [];
      list.push({ ts: row.time, value });
      out.set(stateKey, list);
    }
  }
  return out;
}
