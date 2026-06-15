import {
  type BackfillRange,
  type CandleRepository,
  type IndicatorComputeResult,
  IndicatorError,
  IndicatorNotFoundError,
  type IndicatorStatePoint,
  type Period,
  SymbolNotFoundError,
  validateIndicatorInputs,
  type WatchlistRepository,
} from '@lametrader/core';
import type { IndicatorRegistry } from './indicator-registry.js';

/**
 * Application use-case for computing an indicator over a symbol+period's stored candles.
 *
 * Request-driven, computed **on read** (no persistence), over **confirmed/historical** candles only.
 *
 * The pure `compute` from {@link IndicatorRegistry}'s modules is unchanged; this service is the I/O wrapper that loads candles, validates inputs against descriptors, runs the module, and slices the result.
 */
export class IndicatorComputeService {
  /**
   * @param indicators - the indicator catalog registry.
   * @param watchlist - the watchlist (a symbol must be watched to be computable).
   * @param candles - the candle persistence port.
   */
  constructor(
    private readonly indicators: IndicatorRegistry,
    private readonly watchlist: WatchlistRepository,
    private readonly candles: CandleRepository,
  ) {}

  /**
   * Run an indicator over a symbol+period's stored candles and return the aligned state series.
   *
   * Loads candles from the **earliest stored candle** up to `range.to` so a requested sub-range's first row is already past warm-up; the result is then sliced to `[range.from, range.to)`.
   *
   * @throws {@link SymbolNotFoundError} when the symbol is not on the watchlist.
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
    const to = range?.to ?? Number.MAX_SAFE_INTEGER;
    const from = range?.from ?? 0;
    const candles = await this.candles.range(symbolId, period, 0, to);
    const series = module.compute(validated, candles);
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
}
