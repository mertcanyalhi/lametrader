import type {
  BackfillService,
  ConfigService,
  IndicatorRegistry,
  ProfileService,
  SymbolService,
} from '@lametrader/engine';
import type { CandleStreamHub } from './candle-stream-hub.js';

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
   * The backfill use-case (historical candles).
   */
  backfill?: BackfillService;
  /**
   * The live-candle stream hub fed by the polling loop. When present, the
   * multiplexed `GET /stream` WebSocket route is registered.
   */
  candleStream?: CandleStreamHub;
  /**
   * The indicator catalog registry.
   *
   * When present, the `/indicators` routes are registered.
   */
  indicators?: IndicatorRegistry;
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
