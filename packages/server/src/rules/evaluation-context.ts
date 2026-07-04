import { type CandleRepository, OperandKind, type Period, type StateValue } from '@lametrader/core';
import { type BarAxis, BarSeriesView } from './bar-series-view.js';
import type { EvaluationContext } from './evaluation-context.types.js';
import { ArraySeriesView, type IndicatorSeriesStore } from './indicator-series-store.js';
import type { SeriesPoint, SeriesView } from './series.types.js';

/**
 * Inputs for {@link buildEvaluationContext}.
 *
 * Builds one fresh context per inbound evaluation event. The orchestrator
 * (later slice #392) wires the live tick rings + state lookups in; the
 * candle repository + indicator store are long-lived services.
 */
export interface EvaluationContextDeps {
  /** Firing symbol — operands always read from this symbol per ADR 0016. */
  symbolId: string;
  /**
   * Profile owning the rule, used to namespace state lookups (#281 — state
   * is partitioned by profile so two profiles can't read each other's keys).
   */
  profileId: string;
  /** Read-side candle store for OHLCV operands. */
  candleRepository: CandleRepository;
  /** In-memory indicator series store (`IndicatorRef` operand). */
  indicatorStore: IndicatorSeriesStore;
  /**
   * Half-open `[from, to)` window used when projecting an OHLCV bar series.
   *
   * The orchestrator scopes this to the operator's needed lookback; the
   * default in tests is "all bars stored for the symbol".
   */
  barWindow: { from: number; to: number };
  /** Read for `SymbolStateRef` operands; `null` when the key isn't set. */
  getSymbolState(profileId: string, symbolId: string, key: string): StateValue | null;
  /** Read for `GlobalStateRef` operands; `null` when the key isn't set. */
  getGlobalState(profileId: string, key: string): StateValue | null;
  /**
   * Optional one-step-back lookup for `SymbolStateRef` operands.
   * Used by `State` operators (`ChangesTo` / `ChangesFrom`); when omitted, the
   * context returns `null` for prev state — operators that need it short-circuit
   * to `false`.
   */
  getPrevSymbolState?(profileId: string, symbolId: string, key: string): StateValue | null;
  /** Optional one-step-back lookup for `GlobalStateRef` operands; see {@link getPrevSymbolState}. */
  getPrevGlobalState?(profileId: string, key: string): StateValue | null;
  /**
   * Optional one-step-back lookup for non-numeric `IndicatorRef` operands
   * (Bool / Enum state-keys aren't projected into the in-memory series store).
   * When the key IS numeric, the context derives `prev` from the second-newest
   * point on `indicatorStore.series` instead.
   */
  getPrevIndicator?(instanceId: string, stateKey: string): StateValue | null;
  /**
   * OHLCV bar series the orchestrator pre-loaded for this evaluation, keyed
   * by `(period, axis)` (`barSeriesKey(period, axis)`).
   * The sync `resolveLatest` / `resolveSeries` paths read from this map —
   * the `CandleRepository` is async and the operator contract is sync, so
   * the orchestrator (or {@link prewarmBarSeries}) is responsible for
   * warming the cache before invoking operators.
   *
   * Defaults to empty when omitted; operators see length-0 series and treat
   * the operand as "no data yet" rather than crashing.
   *
   * Widened to {@link SeriesView} so lazy single-point projections (e.g.
   * `LiveEvaluationLookups.bookSeriesFor`) satisfy the slot without
   * paying the `BarSeriesView.load` round-trip every evaluation.
   */
  barSeries?: ReadonlyMap<string, SeriesView>;
}

/**
 * Build a fresh {@link EvaluationContext} for one inbound evaluation.
 *
 * Pure: resolves operands by dispatching on `kind` and reading the
 * injected stores. OHLCV bars are read from `deps.barSeries`, which the
 * orchestrator pre-warms via {@link prewarmBarSeries} (one async load per
 * `(period, axis)`); every operator call after that is synchronous.
 */
export function buildEvaluationContext(deps: EvaluationContextDeps): EvaluationContext {
  const barSeries: ReadonlyMap<string, SeriesView> =
    deps.barSeries ?? new Map<string, SeriesView>();

  return {
    symbolId: deps.symbolId,
    resolveLatest(operand, interval) {
      switch (operand.kind) {
        case OperandKind.Price:
          return priceSeries(barSeries, interval)?.asOf(Number.MAX_SAFE_INTEGER)?.value ?? null;
        case OperandKind.Open:
        case OperandKind.High:
        case OperandKind.Low:
        case OperandKind.Close:
        case OperandKind.Volume: {
          const view = barSeriesFor(barSeries, interval, operandToAxis(operand));
          return view?.asOf(Number.MAX_SAFE_INTEGER)?.value ?? null;
        }
        case OperandKind.IndicatorRef:
          return deps.indicatorStore.latest(operand.instanceId, operand.stateKey);
        case OperandKind.SymbolStateRef:
          return deps.getSymbolState(deps.profileId, deps.symbolId, operand.key);
        case OperandKind.GlobalStateRef:
          return deps.getGlobalState(deps.profileId, operand.key);
        case OperandKind.Literal:
          return operand.value;
      }
    },
    resolvePrev(operand, interval) {
      switch (operand.kind) {
        case OperandKind.Price: {
          const view = priceSeries(barSeries, interval);
          return view ? prevFromSeries(view) : null;
        }
        case OperandKind.Open:
        case OperandKind.High:
        case OperandKind.Low:
        case OperandKind.Close:
        case OperandKind.Volume: {
          const view = barSeriesFor(barSeries, interval, operandToAxis(operand));
          return view ? prevFromSeries(view) : null;
        }
        case OperandKind.IndicatorRef: {
          const series = deps.indicatorStore.series(operand.instanceId, operand.stateKey);
          if (series.length >= 2) return prevFromSeries(series);
          return deps.getPrevIndicator?.(operand.instanceId, operand.stateKey) ?? null;
        }
        case OperandKind.SymbolStateRef:
          return deps.getPrevSymbolState?.(deps.profileId, deps.symbolId, operand.key) ?? null;
        case OperandKind.GlobalStateRef:
          return deps.getPrevGlobalState?.(deps.profileId, operand.key) ?? null;
        case OperandKind.Literal:
          return operand.value;
      }
    },
    resolveSeries(operand, interval) {
      switch (operand.kind) {
        case OperandKind.Price:
          return priceSeries(barSeries, interval) ?? EMPTY_SERIES;
        case OperandKind.Open:
        case OperandKind.High:
        case OperandKind.Low:
        case OperandKind.Close:
        case OperandKind.Volume: {
          const view = barSeriesFor(barSeries, interval, operandToAxis(operand));
          return view ?? EMPTY_SERIES;
        }
        case OperandKind.IndicatorRef:
          return deps.indicatorStore.series(operand.instanceId, operand.stateKey);
        case OperandKind.SymbolStateRef: {
          const v = deps.getSymbolState(deps.profileId, deps.symbolId, operand.key);
          return v ? singletonSeries(v) : EMPTY_SERIES;
        }
        case OperandKind.GlobalStateRef: {
          const v = deps.getGlobalState(deps.profileId, operand.key);
          return v ? singletonSeries(v) : EMPTY_SERIES;
        }
        case OperandKind.Literal:
          return singletonSeries(operand.value);
      }
    },
  };
}

/**
 * Build a `Map<barSeriesKey, BarSeriesView>` covering every `(period, axis)`
 * pair the orchestrator needs, ready to feed `EvaluationContextDeps.barSeries`.
 *
 * One async load per pair; the resulting map is fully synchronous to read.
 */
export async function prewarmBarSeries(
  candleRepository: CandleRepository,
  symbolId: string,
  barWindow: { from: number; to: number },
  required: ReadonlyArray<{ period: Period; axis: BarAxis }>,
): Promise<Map<string, BarSeriesView>> {
  const out = new Map<string, BarSeriesView>();
  for (const { period, axis } of required) {
    const view = await BarSeriesView.load(
      candleRepository,
      symbolId,
      period,
      barWindow.from,
      barWindow.to,
      axis,
    );
    out.set(barSeriesKey(period, axis), view);
  }
  return out;
}

/**
 * Cache key for the pre-warmed bar series map — one slot per `(period, axis)`.
 *
 * Keyed by period so a rule row scoped to one interval resolves its OHLCV
 * operands independently of another period's most recent bar (#463).
 */
export function barSeriesKey(period: Period, axis: BarAxis): string {
  return `${period}|${axis}`;
}

/**
 * The bar-close series that backs the `Price` operand. The platform ingests
 * candles, not trades, so "the current price" is the latest bar close (the
 * forming bar's close is the last observed trade).
 *
 * A `Price` leaf that also references an OHLCV / indicator operand carries the
 * row `interval`, so read that period's close. A bare `Price`-vs-literal leaf
 * has no interval, so fall back to any observed period's close — every forming
 * bar's close reflects the same latest trade, so the period doesn't change the
 * value. Returns `undefined` when the symbol has no observed candle yet.
 */
function priceSeries(
  barSeries: ReadonlyMap<string, SeriesView>,
  interval: Period | undefined,
): SeriesView | undefined {
  if (interval !== undefined) return barSeries.get(barSeriesKey(interval, 'close'));
  for (const [key, view] of barSeries) {
    if (key.endsWith('|close')) return view;
  }
  return undefined;
}

/**
 * Look up the `(period, axis)` bar series for an OHLCV operand.
 *
 * `interval` is the resolving leaf's row interval; when absent (a condition
 * that slipped past validation) there is no period to key on, so the read
 * yields `null` rather than silently borrowing another period's series.
 */
function barSeriesFor(
  barSeries: ReadonlyMap<string, SeriesView>,
  interval: Period | undefined,
  axis: BarAxis,
): SeriesView | undefined {
  if (interval === undefined) return undefined;
  return barSeries.get(barSeriesKey(interval, axis));
}

/**
 * Map an OHLCV operand kind to its candle axis. Total — the caller has
 * already narrowed the operand to one of the five OHLCV kinds.
 */
function operandToAxis(
  operand:
    | { kind: OperandKind.Open }
    | { kind: OperandKind.High }
    | { kind: OperandKind.Low }
    | { kind: OperandKind.Close }
    | { kind: OperandKind.Volume },
): BarAxis {
  switch (operand.kind) {
    case OperandKind.Open:
      return 'open';
    case OperandKind.High:
      return 'high';
    case OperandKind.Low:
      return 'low';
    case OperandKind.Close:
      return 'close';
    case OperandKind.Volume:
      return 'volume';
  }
}

/**
 * The second-newest point's value on a series, or `null` when the series
 * has fewer than two points.
 *
 * Walks the (lazy) backward iterator just far enough — skips the newest
 * point, returns the next.
 */
function prevFromSeries(series: SeriesView): StateValue | null {
  if (series.length < 2) return null;
  let skippedNewest = false;
  for (const point of series.backwardWalk()) {
    if (!skippedNewest) {
      skippedNewest = true;
      continue;
    }
    return point.value;
  }
  return null;
}

/**
 * A read-only series with no points — returned for operands whose backing
 * store is empty (no ticks yet, no bars in window, unset state key).
 *
 * Single shared instance — the view holds no per-evaluation state.
 */
const EMPTY_SERIES: SeriesView = new ArraySeriesView([]);

/**
 * Single-point series at `ts: 0` carrying `value`.
 *
 * Used for stationary operands (`Literal`, `SymbolStateRef`, `GlobalStateRef`)
 * where the value isn't time-indexed — `asOf(any)` returns it regardless of
 * `queryTs`, so the operator contract stays uniform across operand kinds.
 */
function singletonSeries(value: StateValue): SeriesView {
  const point: SeriesPoint = { ts: 0, value };
  return new ArraySeriesView([point]);
}
