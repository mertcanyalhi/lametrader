import type { FiringStateRepository } from '@lametrader/core';
import type { Collection, Db } from 'mongodb';
import type { RuleDocument } from './mongo-rule-repository.types.js';

/**
 * MongoDB-backed {@link FiringStateRepository}.
 *
 * Per ADR 0012, the firing-state latch lives as a `firingState: { [symbolId]:
 * boolean }` sub-doc map on the rule document itself. Reads project the
 * single keyed entry; writes use `$set` on the dotted path so concurrent
 * writes for different symbols don't replace each other's slot. Entries
 * vanish implicitly when the rule is deleted — no explicit cascade needed.
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

  /** The typed `rules` collection. */
  private get collection(): Collection<RuleDocument> {
    return this.db.collection<RuleDocument>('rules');
  }

  async getActive(ruleId: string, symbolId: string): Promise<boolean> {
    const doc = await this.collection.findOne(
      { _id: ruleId },
      { projection: { [`firingState.${symbolId}`]: 1 } },
    );
    return doc?.firingState?.[symbolId] ?? false;
  }

  async setActive(ruleId: string, symbolId: string, active: boolean): Promise<void> {
    await this.collection.updateOne(
      { _id: ruleId },
      { $set: { [`firingState.${symbolId}`]: active } },
    );
  }
}
