import { MongoClient } from 'mongodb';
import { ConfigService } from '../config/config-service.js';
import { MongoConfigRepository } from '../config/mongo-config-repository.js';
import { BinanceMarketDataSource } from './binance-market-data-source.js';
import { MongoWatchlistRepository } from './mongo-watchlist-repository.js';
import { SymbolService } from './symbol-service.js';
import { YahooMarketDataSource } from './yahoo-market-data-source.js';

/**
 * Composition helper: connect to MongoDB and build a {@link SymbolService} wired
 * with the real market-data sources (Binance for crypto, Yahoo for stocks/funds/
 * FX), a Mongo watchlist, and a Mongo-backed config. Used by the driving adapters'
 * entry points (api, cli) so neither depends on the adapters directly.
 *
 * @param uri - the MongoDB connection string (database taken from the URI).
 * @returns the wired service plus a `close` to release the connection.
 */
export async function connectSymbolService(
  uri: string,
): Promise<{ service: SymbolService; close: () => Promise<void> }> {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const service = new SymbolService(
    [new BinanceMarketDataSource(), new YahooMarketDataSource()],
    new MongoWatchlistRepository(db),
    new ConfigService(new MongoConfigRepository(db)),
  );
  return {
    service,
    close: async () => {
      await client.close();
    },
  };
}
