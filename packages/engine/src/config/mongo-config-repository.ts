import { type Config, type ConfigRepository, parseConfig } from '@lametrader/core';
import type { Db } from 'mongodb';
import type { ConfigDocument } from './mongo-config-repository.types.js';

/**
 * The fixed `_id` of the singleton config document.
 */
const CONFIG_ID = 'singleton';

/**
 * MongoDB-backed {@link ConfigRepository}. Stores the global config as a single
 * upserted document in the `config` collection.
 */
export class MongoConfigRepository implements ConfigRepository {
  /**
   * The database handle to read/write the `config` collection on.
   */
  private readonly db: Db;

  /**
   * @param db - a connected MongoDB database handle.
   */
  constructor(db: Db) {
    this.db = db;
  }

  /**
   * Load and validate the persisted config, or `null` if absent.
   */
  async load(): Promise<Config | null> {
    const doc = await this.db.collection<ConfigDocument>('config').findOne({ _id: CONFIG_ID });
    if (!doc) {
      return null;
    }
    return parseConfig({ periods: doc.periods, defaultPeriod: doc.defaultPeriod });
  }

  /**
   * Upsert the singleton config document.
   */
  async save(config: Config): Promise<void> {
    await this.db
      .collection<ConfigDocument>('config')
      .replaceOne(
        { _id: CONFIG_ID },
        { periods: config.periods, defaultPeriod: config.defaultPeriod },
        { upsert: true },
      );
  }
}
