import { type CandleRepository, OperandKind, type Period, type StateValue } from '@lametrader/core';
import { type BarAxis, PagedBarSeriesView } from './bar-series-view.js';
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
   * OHLCV bar series the orchestrator wired for this evaluation, keyed by
   * `(period, axis)` (`barSeriesKey(period, axis)`).
   * The `resolveLatest` / `resolveSeries` paths read from this map; each view
   * is a lazy {@link SeriesView} (typically a {@link PagedBarSeriesView} pager
   * over the async `CandleRepository`), so no full-history load happens up front
   * — a view pages the store only when an operator walks it.
   *
   * Defaults to empty when omitted; operators see an empty walk and treat
   * the operand as "no data yet" rather than crashing.
   *
   * Typed as {@link SeriesView} so lazy pagers, single-point live-mirror
   * projections (`LiveEvaluationLookups.bookSeriesFor`), and array views all
   * satisfy the slot uniformly.
   */
  barSeries?: ReadonlyMap<string, SeriesView>;
}

/**
 * Build a fresh {@link EvaluationContext} for one inbound evaluation.
 *
 * Resolves operands by dispatching on `kind` and reading the injected stores.
 * OHLCV bars are read from `deps.barSeries`, whose views (lazy pagers built by
 * {@link prewarmBarSeries}) page the candle repository only as an operator walks
 * — the reads are async, so `resolveLatest` / `resolvePrev` return promises.
 */
export function buildEvaluationContext(deps: EvaluationContextDeps): EvaluationContext {
  const barSeries: ReadonlyMap<string, SeriesView> =
    deps.barSeries ?? new Map<string, SeriesView>();

  return {
    symbolId: deps.symbolId,
    async resolveLatest(operand, interval) {
      switch (operand.kind) {
        case OperandKind.Price: {
          const view = priceSeries(barSeries, interval);
          return view ? ((await view.asOf(Number.MAX_SAFE_INTEGER))?.value ?? null) : null;
        }
        case OperandKind.Open:
        case OperandKind.High:
        case OperandKind.Low:
        case OperandKind.Close:
        case OperandKind.Volume: {
          const view = barSeriesFor(barSeries, interval, operandToAxis(operand));
          return view ? ((await view.asOf(Number.MAX_SAFE_INTEGER))?.value ?? null) : null;
        }
        case OperandKind.IndicatorRef:
          if (interval === undefined) return null;
          return deps.indicatorStore.latest(
            deps.symbolId,
            interval,
            operand.instanceId,
            operand.stateKey,
          );
        case OperandKind.SymbolStateRef:
          return deps.getSymbolState(deps.profileId, deps.symbolId, operand.key);
        case OperandKind.GlobalStateRef:
          return deps.getGlobalState(deps.profileId, operand.key);
        case OperandKind.Literal:
          return operand.value;
      }
    },
    async resolvePrev(operand, interval) {
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
          if (interval === undefined) return null;
          const series = deps.indicatorStore.series(
            deps.symbolId,
            interval,
            operand.instanceId,
            operand.stateKey,
          );
          // A series with a second-newest point yields it (walk-and-count, since
          // the view carries no length); otherwise fall to the optional hook for
          // non-numeric indicator keys not projected into the store.
          const prev = await prevFromSeries(series);
          return prev ?? deps.getPrevIndicator?.(operand.instanceId, operand.stateKey) ?? null;
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
          if (interval === undefined) return EMPTY_SERIES;
          return deps.indicatorStore.series(
            deps.symbolId,
            interval,
            operand.instanceId,
            operand.stateKey,
          );
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
 * Build a `Map<barSeriesKey, PagedBarSeriesView>` covering every `(period, axis)`
 * pair the orchestrator needs, ready to feed `EvaluationContextDeps.barSeries`.
 *
 * Each entry is a lazy pager over the candle repository bounded above by
 * `before` (exclusive) — building the map does no I/O; a pager fetches its first
 * page only when an operator actually walks or `asOf`-queries that operand, so a
 * warmed `(period, axis)` a rule never reads never touches the store.
 *
 * `before` bounds the newest candle any pager may read (`time < before`) — pass
 * the firing observation's timestamp + 1 so a later-ts candle already in the
 * store can't become the series' newest point.
 */
export function prewarmBarSeries(
  candleRepository: CandleRepository,
  symbolId: string,
  before: number,
  required: ReadonlyArray<{ period: Period; axis: BarAxis }>,
): Map<string, PagedBarSeriesView> {
  const out = new Map<string, PagedBarSeriesView>();
  for (const { period, axis } of required) {
    out.set(
      barSeriesKey(period, axis),
      new PagedBarSeriesView(candleRepository, symbolId, period, axis, before),
    );
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
 * Walks the lazy backward iterator just far enough — skips the newest point,
 * returns the next — so a paging view fetches at most the one page the two
 * points live on.
 */
async function prevFromSeries(series: SeriesView): Promise<StateValue | null> {
  let skippedNewest = false;
  for await (const point of series.backwardWalk()) {
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
