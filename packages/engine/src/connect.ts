import type { Period } from '@lametrader/core';
import { MongoClient } from 'mongodb';
import { BackfillService } from './candles/backfill-service.js';
import { MongoCandleRepository } from './candles/mongo-candle-repository.js';
import { PollingService } from './candles/polling-service.js';
import type { CandleListener } from './candles/polling-service.types.js';
import { ConfigService } from './config/config-service.js';
import { MongoConfigRepository } from './config/mongo-config-repository.js';
import { defaultMarketDataSources } from './symbols/default-sources.js';
import { MongoWatchlistRepository } from './symbols/mongo-watchlist-repository.js';
import { SymbolService } from './symbols/symbol-service.js';

/**
 * Options for {@link connectServices}: the live-candle sink and per-period poll
 * cadence the {@link PollingService} is built with.
 */
export interface ConnectOptions {
  /** Where the polling loop emits each observed candle (defaults to a no-op). */
  onCandle?: CandleListener;
  /** Per-period poll cadence in ms (required to enable a useful polling loop). */
  pollIntervals: Record<Period, number>;
}

/**
 * The platform's wired use-cases, sharing one MongoDB connection.
 */
export interface ConnectedServices {
  /** The configuration use-case. */
  config: ConfigService;
  /** The symbols use-case (discovery / watchlist). */
  symbols: SymbolService;
  /** The backfill use-case (historical candles). */
  backfill: BackfillService;
  /** The continuous polling + live-streaming loop. */
  polling: PollingService;
  /** Release the shared MongoDB connection. */
  close: () => Promise<void>;
}

/**
 * The single composition root: open one MongoDB connection, register the default
 * market-data sources once, and wire every use-case on top — the
 * {@link ConfigService}, {@link SymbolService} (which share that config),
 * {@link BackfillService}, and the {@link PollingService} (continuous polling +
 * live streaming). Driving adapters (api, cli) build the whole platform from here,
 * so neither depends on the Mongo driver or the concrete adapters, and a new
 * source or store is added in exactly one place.
 *
 * @param uri - the MongoDB connection string (database taken from the URI).
 * @param options - the live-candle sink and poll cadence for the polling loop.
 * @returns the wired services plus a `close` to release the connection.
 */
export async function connectServices(
  uri: string,
  options: ConnectOptions,
): Promise<ConnectedServices> {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const sources = defaultMarketDataSources();
  const watchlist = new MongoWatchlistRepository(db);
  const candleRepo = new MongoCandleRepository(db);
  await candleRepo.ensureIndexes();
  const config = new ConfigService(new MongoConfigRepository(db));
  const symbols = new SymbolService(sources, watchlist, config, candleRepo);
  const backfill = new BackfillService(sources, candleRepo, watchlist);
  const polling = new PollingService(sources, candleRepo, watchlist, {
    onCandle: options.onCandle ?? (() => {}),
    intervals: options.pollIntervals,
  });
  return {
    config,
    symbols,
    backfill,
    polling,
    close: async () => {
      await client.close();
    },
  };
}
