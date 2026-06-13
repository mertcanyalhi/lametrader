import type { BackfillService, ConfigService, SymbolService } from '@lametrader/engine';
import type { CandleStreamHub } from './candle-stream-hub.js';

/**
 * The use-cases the REST app drives. `symbols` is optional so config-focused
 * tests can build a minimal app; the entry point provides both.
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
   * The backfill use-case (historical candles). Optional like `symbols`.
   */
  backfill?: BackfillService;
  /**
   * The live-candle stream hub fed by the polling loop. When present, the
   * multiplexed `GET /stream` WebSocket route is registered. Optional like
   * `symbols`.
   */
  candleStream?: CandleStreamHub;
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
