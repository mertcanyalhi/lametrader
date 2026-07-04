import type { ConfigKey, ConfigRepository } from '@lametrader/core';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { ConfigEntry } from './config-entry.schema.js';

/**
 * Mongoose-backed {@link ConfigRepository}. A dumb key-value store: each
 * {@link ConfigKey} is one upserted {@link ConfigEntry} document in the `config`
 * collection, keyed by `_id`. Knows nothing about config shape or validity —
 * that is the application layer's job.
 *
 * Replaces the native-driver `MongoConfigRepository`; the shared
 * `runConfigRepositoryContract` suite proves the swap is behavior-identical.
 */
@Injectable()
export class MongooseConfigRepository implements ConfigRepository {
  /**
   * @param model - the `config`-collection model injected by `@nestjs/mongoose`.
   */
  constructor(@InjectModel(ConfigEntry.name) private readonly model: Model<ConfigEntry>) {}

  /**
   * Read the value stored at `key`, or `undefined` if absent.
   */
  async get(key: ConfigKey): Promise<unknown> {
    const doc = await this.model.findById(key).lean().exec();
    return doc?.value;
  }

  /**
   * Upsert the value at `key`.
   */
  async set(key: ConfigKey, value: unknown): Promise<void> {
    await this.model.updateOne({ _id: key }, { $set: { value } }, { upsert: true }).exec();
  }
}
