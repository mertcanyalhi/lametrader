import type { FiringStateRepository } from '@lametrader/core';
import type { Collection, Db } from 'mongodb';
import type { FiringStateDocument } from './mongo-firing-state-repository.types.js';

/**
 * MongoDB-backed {@link FiringStateRepository}.
 *
 * Stores one document per `(ruleId, symbolId)` in the `firing_state`
 * collection, keyed by a compound `_id` of the same shape. The compound `_id`
 * is unique by construction — no extra index needed.
 */
export class MongoFiringStateRepository implements FiringStateRepository {
  /** The database handle. */
  private readonly db: Db;

  /**
   * @param db - a connected MongoDB database handle.
   */
  constructor(db: Db) {
    this.db = db;
  }

  /** The typed `firing_state` collection. */
  private get collection(): Collection<FiringStateDocument> {
    return this.db.collection<FiringStateDocument>('firing_state');
  }

  async getActive(ruleId: string, symbolId: string): Promise<boolean> {
    const doc = await this.collection.findOne({ _id: { ruleId, symbolId } });
    return doc?.active ?? false;
  }

  async setActive(ruleId: string, symbolId: string, active: boolean): Promise<void> {
    await this.collection.replaceOne({ _id: { ruleId, symbolId } }, { active }, { upsert: true });
  }

  async removeByRule(ruleId: string): Promise<void> {
    await this.collection.deleteMany({ '_id.ruleId': ruleId });
  }
}
