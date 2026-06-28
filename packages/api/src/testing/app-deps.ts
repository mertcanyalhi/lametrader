import type { IndicatorStateEvent, SymbolQuoteEvent } from '@lametrader/core';
import {
  BackfillService,
  type CandleEvent,
  ConfigService,
  defaultIndicators,
  type IndicatorRegistry,
  IndicatorService,
  InMemoryCandleRepository,
  InMemoryConfigRepository,
  InMemoryMarketDataSource,
  InMemoryProfileRepository,
  InMemoryRuleRepository,
  InMemoryWatchlistRepository,
  ProfileService,
  QuoteStreamService,
  RuleService,
  SymbolService,
} from '@lametrader/engine';
import type { AppDependencies } from '../app.types.js';
import { StreamHub } from '../stream-hub.js';

/**
 * Override shape accepted by `buildAppDeps`.
 *
 * Same shape as {@link AppDependencies} except that the `indicators` bundle's pieces can each be overridden independently — a test that supplies a custom registry doesn't need to also construct a compute service (and vice versa).
 */
export interface BuildAppDepsOverrides extends Partial<Omit<AppDependencies, 'indicators'>> {
  indicators?: {
    registry?: IndicatorRegistry;
    compute?: IndicatorService;
  };
}

/**
 * Build a complete {@link AppDependencies} for tests, backed by in-memory adapters, with any service overridden by `overrides`.
 *
 * Lets a focused test supply only the use-case it exercises while the app still wires the full, production-shaped surface (all routes registered).
 *
 * @param overrides - services to use instead of the in-memory defaults.
 */
export function buildAppDeps(overrides: BuildAppDepsOverrides = {}): AppDependencies {
  const config = overrides.config ?? new ConfigService(new InMemoryConfigRepository());
  const watchlist = new InMemoryWatchlistRepository();
  const candles = new InMemoryCandleRepository();
  const sources = [new InMemoryMarketDataSource([])];
  const registry = overrides.indicators?.registry ?? defaultIndicators();
  const indicatorService =
    overrides.liveStream?.indicatorService ??
    overrides.indicators?.compute ??
    new IndicatorService(registry, watchlist, candles);
  const profiles =
    overrides.profiles ?? new ProfileService(new InMemoryProfileRepository(), watchlist, registry);
  const rules = overrides.rules ?? new RuleService(new InMemoryRuleRepository());

  // Default live-stream wiring: the in-memory candle + indicator hubs and a stream
  // service the controller talks to. Tests that don't exercise streaming get the
  // route registered but inert (no candles flow through unless they publish).
  const candleStream = overrides.liveStream?.candleStream ?? new StreamHub<CandleEvent>();
  const indicatorStream =
    overrides.liveStream?.indicatorStream ?? new StreamHub<IndicatorStateEvent>();
  const quoteStream = overrides.liveStream?.quoteStream ?? new StreamHub<SymbolQuoteEvent>();
  const quoteStreamService =
    overrides.liveStream?.quoteStreamService ??
    new QuoteStreamService(watchlist, config, candles, {
      onQuote: (event) => quoteStream.publish(event.subscriptionId, event),
    });

  return {
    config,
    symbols: overrides.symbols ?? new SymbolService(sources, watchlist, config, candles, profiles),
    profiles,
    rules,
    ...(overrides.state ? { state: overrides.state } : {}),
    ...(overrides.telegramDestinations
      ? { telegramDestinations: overrides.telegramDestinations }
      : {}),
    backfill: overrides.backfill ?? new BackfillService(sources, candles, watchlist),
    indicators: { registry, compute: indicatorService },
    liveStream: {
      candleStream,
      indicatorStream,
      indicatorService,
      quoteStream,
      quoteStreamService,
    },
  };
}
