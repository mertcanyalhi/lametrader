import { MongoClient } from 'mongodb';
import { BackfillService } from './candles/backfill-service.js';
import { MongoCandleRepository } from './candles/mongo-candle-repository.js';
import { ConfigService } from './config/config-service.js';
import { MongoConfigRepository } from './config/mongo-config-repository.js';
import { BinanceMarketDataSource } from './symbols/binance-market-data-source.js';
import { MongoWatchlistRepository } from './symbols/mongo-watchlist-repository.js';
import { SymbolService } from './symbols/symbol-service.js';
import { YahooMarketDataSource } from './symbols/yahoo-market-data-source.js';

/**
 * Composition helper for a driving adapter that needs the whole platform: one
 * MongoDB connection wired into both the {@link ConfigService} and the
 * {@link SymbolService} (which share that config). Keeps the entry points free of
 * the Mongo driver and the concrete adapters.
 *
 * @param uri - the MongoDB connection string (database taken from the URI).
 * @returns the wired services plus a `close` to release the connection.
 */
export async function connectServices(uri: string): Promise<{
  config: ConfigService;
  symbols: SymbolService;
  backfill: BackfillService;
  close: () => Promise<void>;
}> {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const sources = [new BinanceMarketDataSource(), new YahooMarketDataSource()];
  const watchlist = new MongoWatchlistRepository(db);
  const candleRepo = new MongoCandleRepository(db);
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
