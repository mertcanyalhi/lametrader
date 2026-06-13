import { type MarketDataSource, SymbolError, type SymbolType } from '@lametrader/core';

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
