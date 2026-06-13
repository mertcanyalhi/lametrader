import { type MarketDataSource, type Period, SymbolError, type SymbolType } from '@lametrader/core';

/**
 * Resolve the {@link MarketDataSource} that serves a given asset {@link SymbolType}
 * from a set of registered sources. Shared by the application use-cases
 * ({@link import('./symbol-service.js').SymbolService},
 * {@link import('../candles/backfill-service.js').BackfillService}) so the
 * source-selection rule lives in one place.
 *
 * @param sources - the registered market-data providers.
 * @param type - the asset class to serve.
 * @throws {@link SymbolError} when no registered source serves the type.
 */
export function sourceForType(sources: MarketDataSource[], type: SymbolType): MarketDataSource {
  const source = sources.find((candidate) => candidate.types.includes(type));
  if (!source) {
    throw new SymbolError(`no market-data source for type: ${type}`);
  }
  return source;
}

/**
 * Assert that every period in `periods` is one the `source` can fetch. A symbol
 * may only be watched at periods its owning source supports — Yahoo, for
 * instance, has no 4h bar — so this guards `add`/`setPeriods` before persisting.
 *
 * @param source - the owning market-data source.
 * @param periods - the periods to validate against the source's capability.
 * @throws {@link SymbolError} when any period is not in `source.periods`.
 */
export function assertSourceSupportsPeriods(source: MarketDataSource, periods: Period[]): void {
  const unsupported = periods.filter((period) => !source.periods.includes(period));
  if (unsupported.length > 0) {
    throw new SymbolError(`source does not support period(s): ${unsupported.join(', ')}`);
  }
}
