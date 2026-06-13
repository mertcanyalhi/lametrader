import { MongoClient } from 'mongodb';
import { BackfillService } from './candles/backfill-service.js';
import { MongoCandleRepository } from './candles/mongo-candle-repository.js';
import { ConfigService } from './config/config-service.js';
import { MongoConfigRepository } from './config/mongo-config-repository.js';
import { defaultMarketDataSources } from './symbols/default-sources.js';
import { MongoWatchlistRepository } from './symbols/mongo-watchlist-repository.js';
import { SymbolService } from './symbols/symbol-service.js';

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
  /** Release the shared MongoDB connection. */
  close: () => Promise<void>;
}

/**
 * The single composition root: open one MongoDB connection, register the
 * default market-data sources once, and wire every use-case on top. Driving
 * adapters (api, cli) build the whole platform from here, so neither depends on
 * the Mongo driver or the concrete adapters, and a new source or store is added
 * in exactly one place.
 *
 * @param uri - the MongoDB connection string (database taken from the URI).
 * @returns the wired services plus a `close` to release the connection.
 */
export async function connectServices(uri: string): Promise<ConnectedServices> {
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
  return {
    config,
    symbols,
    backfill,
    close: async () => {
      await client.close();
    },
  };
}
