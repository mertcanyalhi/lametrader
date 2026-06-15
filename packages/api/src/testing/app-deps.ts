import {
  BackfillService,
  ConfigService,
  defaultIndicators,
  InMemoryCandleRepository,
  InMemoryMarketDataSource,
  InMemoryProfileRepository,
  InMemoryWatchlistRepository,
  ProfileService,
  SymbolService,
} from '@lametrader/engine';
import type { AppDependencies } from '../app.types.js';

/**
 * Build a complete {@link AppDependencies} for tests, backed by in-memory
 * adapters, with any service overridden by `overrides`. Lets a focused test
 * supply only the use-case it exercises while the app still wires the full,
 * production-shaped surface (all routes registered).
 *
 * @param overrides - services to use instead of the in-memory defaults.
 */
export function buildAppDeps(overrides: Partial<AppDependencies> = {}): AppDependencies {
  const config =
    overrides.config ?? new ConfigService({ load: async () => null, save: async () => {} });
  const watchlist = new InMemoryWatchlistRepository();
  const candles = new InMemoryCandleRepository();
  const sources = [new InMemoryMarketDataSource([])];
  const profiles =
    overrides.profiles ?? new ProfileService(new InMemoryProfileRepository(), watchlist);
  return {
    config,
    symbols: overrides.symbols ?? new SymbolService(sources, watchlist, config, candles, profiles),
    profiles,
    backfill: overrides.backfill ?? new BackfillService(sources, candles, watchlist),
    indicators: overrides.indicators ?? defaultIndicators(),
  };
}
