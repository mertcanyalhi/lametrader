import type { IndicatorStateEvent, SymbolQuoteEvent } from '@lametrader/core';
import type {
  BackfillService,
  CandleEvent,
  ConfigService,
  IndicatorComputeService,
  IndicatorRegistry,
  IndicatorStreamService,
  ProfileService,
  QuoteStreamService,
  RuleService,
  SymbolService,
} from '@lametrader/engine';
import type { StreamHub } from './stream-hub.js';

/**
 * The live-stream surface — the candle hub the polling loop publishes to, plus the indicator- and quote-stream services + their WS-side hubs.
 *
 * Paired so the `/stream` route registers all-or-nothing: when streaming is wired, it handles candle, indicator, and quote subscriptions; when absent, the route doesn't register.
 */
export interface LiveStream {
  /** The live-candle pub/sub the polling loop publishes to. */
  candleStream: StreamHub<CandleEvent>;
  /** The indicator-state pub/sub fed by the indicator stream service's `onState` callback. */
  indicatorStream: StreamHub<IndicatorStateEvent>;
  /** The engine-side indicator stream service; the route calls its `subscribe`/`unsubscribe`. */
  indicatorStreamService: IndicatorStreamService;
  /** The quote pub/sub fed by the quote stream service's `onQuote` callback. */
  quoteStream: StreamHub<SymbolQuoteEvent>;
  /** The engine-side quote stream service; the route calls its `subscribe`/`unsubscribe`. */
  quoteStreamService: QuoteStreamService;
}

/**
 * The use-cases the REST app drives. `config` is always present; `symbols`,
 * `backfill`, and `candleStream` are optional so an app can be composed with just
 * the surface it needs — each controller is registered only when its dependency is
 * given. The entry point provides all of them; tests use `buildAppDeps`
 * (`testing/app-deps.ts`) to fill in-memory defaults for a focused app.
 */
export interface AppDependencies {
  /**
   * The configuration use-case.
   */
  config: ConfigService;
  /**
   * The symbols use-case (discovery / watchlist).
   */
  symbols?: SymbolService;
  /**
   * The profiles use-case (CRUD).
   *
   * When present, the `/profiles` routes are registered.
   */
  profiles?: ProfileService;
  /**
   * The rules use-case (read-only for now; CRUD lands in later issues).
   *
   * When present, the `/rules` routes are registered.
   */
  rules?: RuleService;
  /**
   * The backfill use-case (historical candles).
   */
  backfill?: BackfillService;
  /**
   * The live-stream surface.
   *
   * When present, the multiplexed `GET /stream` WebSocket route is registered with handlers for both candle subscriptions and indicator subscriptions.
   *
   * Optional at the app boundary (a tests-only "no streaming" app omits it), but the bundle itself is required — partial wiring would leave a route handling only half its surface.
   */
  liveStream?: LiveStream;
  /**
   * The indicator surface — the catalog registry and the ad-hoc compute use-case, paired.
   *
   * Required: every app the API serves exposes indicators (`/indicators*` catalog routes and `GET /symbols/:id/indicators/:key`).
   */
  indicators: {
    /** The catalog registry (read at runtime for `/indicators[/:key]`). */
    registry: IndicatorRegistry;
    /** The compute use-case (drives `GET /symbols/:id/indicators/:key`). */
    compute: IndicatorComputeService;
  };
}

/**
 * Options for `createApp`.
 */
export interface AppOptions {
  /**
   * Enable Fastify's built-in Pino request logging. Off by default (tests);
   * the entry point turns it on.
   */
  logger?: boolean;
}
