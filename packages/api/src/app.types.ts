import type { BackfillService, ConfigService, SymbolService } from '@lametrader/engine';

/**
 * The use-cases the REST app drives. All are required: the app exposes the same
 * routes however it is constructed (tests build the missing services from
 * in-memory adapters — see `testing/app-deps.ts`).
 */
export interface AppDependencies {
  /**
   * The configuration use-case.
   */
  config: ConfigService;
  /**
   * The symbols use-case (discovery / watchlist).
   */
  symbols: SymbolService;
  /**
   * The backfill use-case (historical candles).
   */
  backfill: BackfillService;
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
