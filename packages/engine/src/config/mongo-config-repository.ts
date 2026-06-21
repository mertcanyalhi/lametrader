import type { ConfigKey, ConfigRepository } from '@lametrader/core';
import type { Db } from 'mongodb';
import type { ConfigDocument } from './mongo-config-repository.types.js';

/**
 * MongoDB-backed {@link ConfigRepository}. A dumb key-value store: each
 * {@link ConfigKey} is one upserted document in the `config` collection, keyed
 * by `_id`. Knows nothing about config shape or validity.
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
   * Read the value stored at `key`, or `undefined` if absent.
   */
  async get(key: ConfigKey): Promise<unknown> {
    const doc = await this.db.collection<ConfigDocument>('config').findOne({ _id: key });
    return doc?.value;
  }

  /**
   * Upsert the value at `key`.
   */
  async set(key: ConfigKey, value: unknown): Promise<void> {
    await this.db
      .collection<ConfigDocument>('config')
      .replaceOne({ _id: key }, { value }, { upsert: true });
  }
}
