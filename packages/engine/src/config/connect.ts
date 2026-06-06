import { MongoClient } from 'mongodb';
import { ConfigService } from './config-service.js';
import { MongoConfigRepository } from './mongo-config-repository.js';

/**
 * Composition helper: connect to MongoDB and build a {@link ConfigService}
 * backed by {@link MongoConfigRepository}. Used by the driving adapters' entry
 * points (api, cli) so neither depends on the Mongo driver directly.
 *
 * @param uri - the MongoDB connection string (database taken from the URI).
 * @returns the wired service plus a `close` to release the connection.
 */
export async function connectConfigService(
  uri: string,
): Promise<{ service: ConfigService; close: () => Promise<void> }> {
  const client = new MongoClient(uri);
  await client.connect();
  const service = new ConfigService(new MongoConfigRepository(client.db()));
  return {
    service,
    close: async () => {
      await client.close();
    },
  };
}
