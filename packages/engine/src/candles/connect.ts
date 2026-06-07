import { MongoClient } from 'mongodb';
import { BinanceMarketDataSource } from '../symbols/binance-market-data-source.js';
import { MongoWatchlistRepository } from '../symbols/mongo-watchlist-repository.js';
import { YahooMarketDataSource } from '../symbols/yahoo-market-data-source.js';
import { BackfillService } from './backfill-service.js';
import { MongoCandleRepository } from './mongo-candle-repository.js';

/**
 * Composition helper: connect to MongoDB and build a {@link BackfillService}
 * wired with the real market-data sources (Binance for crypto, Yahoo for
 * stocks/funds/FX), a Mongo candle store, and the Mongo watchlist. Used by the
 * driving adapters' entry points (api, cli) so neither depends on the adapters
 * directly.
 *
 * @param uri - the MongoDB connection string (database taken from the URI).
 * @returns the wired service plus a `close` to release the connection.
 */
export async function connectBackfillService(
  uri: string,
): Promise<{ service: BackfillService; close: () => Promise<void> }> {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const service = new BackfillService(
    [new BinanceMarketDataSource(), new YahooMarketDataSource()],
    new MongoCandleRepository(db),
    new MongoWatchlistRepository(db),
  );
  return {
    service,
    close: async () => {
      await client.close();
    },
  };
}
