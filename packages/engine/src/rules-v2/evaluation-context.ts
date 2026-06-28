import { type CandleRepository, type Period, RulesV2, type StateValue } from '@lametrader/core';
import { type BarAxis, BarSeriesView } from './bar-series-view.js';
import type { EvaluationContext } from './evaluation-context.types.js';
import { ArraySeriesView, type IndicatorSeriesStore } from './indicator-series-store.js';
import type { SeriesPoint, SeriesView } from './series.types.js';
import type { TickRing } from './tick-ring.js';

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
  /** Per-symbol tick rings (`Price` operand reads from `tickRings.get(symbolId)`). */
  tickRings: ReadonlyMap<string, TickRing>;
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
   * OHLCV bar series the orchestrator pre-loaded for this evaluation, keyed
   * by axis (`barSeriesKey(axis)`).
   * The sync `resolveLatest` / `resolveSeries` paths read from this map —
   * the `CandleRepository` is async and the operator contract is sync, so
   * the orchestrator (or {@link prewarmBarSeries}) is responsible for
   * warming the cache before invoking operators.
   *
   * Defaults to empty when omitted; operators see length-0 series and treat
   * the operand as "no data yet" rather than crashing.
   */
  barSeries?: ReadonlyMap<string, BarSeriesView>;
}

/**
 * Build a fresh {@link EvaluationContext} for one inbound v2 evaluation.
 *
 * Pure: resolves operands by dispatching on `kind` and reading the
 * injected stores. OHLCV bars are read from `deps.barSeries`, which the
 * orchestrator pre-warms via {@link prewarmBarSeries} (one async load per
 * `(period, axis)`); every operator call after that is synchronous.
 */
export function buildEvaluationContext(deps: EvaluationContextDeps): EvaluationContext {
  const tickRing = deps.tickRings.get(deps.symbolId) ?? null;
  const barSeries = deps.barSeries ?? new Map<string, BarSeriesView>();

  return {
    symbolId: deps.symbolId,
    resolveLatest(operand) {
      switch (operand.kind) {
        case RulesV2.OperandKind.Price:
          return tickRing?.asOf(Number.MAX_SAFE_INTEGER)?.value ?? null;
        case RulesV2.OperandKind.Open:
        case RulesV2.OperandKind.High:
        case RulesV2.OperandKind.Low:
        case RulesV2.OperandKind.Close:
        case RulesV2.OperandKind.Volume: {
          const view = barSeries.get(barSeriesKey(operandToAxis(operand)));
          return view?.asOf(Number.MAX_SAFE_INTEGER)?.value ?? null;
        }
        case RulesV2.OperandKind.IndicatorRef:
          return deps.indicatorStore.latest(operand.instanceId, operand.stateKey);
        case RulesV2.OperandKind.SymbolStateRef:
          return deps.getSymbolState(deps.profileId, deps.symbolId, operand.key);
        case RulesV2.OperandKind.GlobalStateRef:
          return deps.getGlobalState(deps.profileId, operand.key);
        case RulesV2.OperandKind.Literal:
          return operand.value;
      }
    },
    resolveSeries(operand) {
      switch (operand.kind) {
        case RulesV2.OperandKind.Price:
          return tickRing ?? EMPTY_SERIES;
        case RulesV2.OperandKind.Open:
        case RulesV2.OperandKind.High:
        case RulesV2.OperandKind.Low:
        case RulesV2.OperandKind.Close:
        case RulesV2.OperandKind.Volume: {
          const view = barSeries.get(barSeriesKey(operandToAxis(operand)));
          return view ?? EMPTY_SERIES;
        }
        case RulesV2.OperandKind.IndicatorRef:
          return deps.indicatorStore.series(operand.instanceId, operand.stateKey);
        case RulesV2.OperandKind.SymbolStateRef: {
          const v = deps.getSymbolState(deps.profileId, deps.symbolId, operand.key);
          return v ? singletonSeries(v) : EMPTY_SERIES;
        }
        case RulesV2.OperandKind.GlobalStateRef: {
          const v = deps.getGlobalState(deps.profileId, operand.key);
          return v ? singletonSeries(v) : EMPTY_SERIES;
        }
        case RulesV2.OperandKind.Literal:
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
    out.set(barSeriesKey(axis), view);
  }
  return out;
}

/**
 * Cache key for the pre-warmed bar series map.
 *
 * Lazy: keyed by axis only — each evaluation context is scoped to one
 * `(symbolId, period)` pair via {@link EvaluationContextDeps.barWindow}, so a
 * single axis uniquely identifies the series in this scope. Upgrade path:
 * when an operator needs to read OHLCV across two periods within one rule,
 * extend the key to `${period}|${axis}` and pass `period` through both the
 * prewarm caller and {@link buildEvaluationContext}'s operand axis mapper.
 */
export function barSeriesKey(axis: BarAxis): string {
  return axis;
}

/**
 * Map an OHLCV operand kind to its candle axis. Total — the caller has
 * already narrowed the operand to one of the five OHLCV kinds.
 */
function operandToAxis(
  operand:
    | { kind: RulesV2.OperandKind.Open }
    | { kind: RulesV2.OperandKind.High }
    | { kind: RulesV2.OperandKind.Low }
    | { kind: RulesV2.OperandKind.Close }
    | { kind: RulesV2.OperandKind.Volume },
): BarAxis {
  switch (operand.kind) {
    case RulesV2.OperandKind.Open:
      return 'open';
    case RulesV2.OperandKind.High:
      return 'high';
    case RulesV2.OperandKind.Low:
      return 'low';
    case RulesV2.OperandKind.Close:
      return 'close';
    case RulesV2.OperandKind.Volume:
      return 'volume';
  }
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
