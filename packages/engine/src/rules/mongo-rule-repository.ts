import { type Rule, type RuleRepository, RuleScopeKind } from '@lametrader/core';
import type { Collection, Db, Filter } from 'mongodb';
import type { RuleDocument } from './mongo-rule-repository.types.js';

/**
 * MongoDB-backed {@link RuleRepository}.
 *
 * Stores each rule as a document in the `rules` collection keyed by id
 * (`_id`). Embedded `events` and `history` arrays live on the same document
 * per ADR 0012.
 */
export class MongoRuleRepository implements RuleRepository {
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

  /**
   * Create the indexes the reads need. Idempotent.
   *
   * - `{ profileId: 1, order: 1 }` — supports per-profile sorted reads (used
   *   by later orchestrator queries).
   * - `{ 'scope.symbolId': 1 }` — supports `listForSymbol`.
   */
  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ profileId: 1, order: 1 });
    await this.collection.createIndex({ 'scope.symbolId': 1 });
  }

  async list(): Promise<Rule[]> {
    const docs = await this.collection.find().toArray();
    return docs.map(toRule);
  }

  async listForSymbol(symbolId: string | null): Promise<Rule[]> {
    const filter: Filter<RuleDocument> =
      symbolId === null
        ? { 'scope.kind': RuleScopeKind.AllSymbols }
        : {
            $or: [
              { 'scope.kind': RuleScopeKind.AllSymbols },
              { 'scope.kind': RuleScopeKind.Symbol, 'scope.symbolId': symbolId },
            ],
          };
    const docs = await this.collection.find(filter).toArray();
    return docs.map(toRule);
  }

  async get(id: string): Promise<Rule | null> {
    const doc = await this.collection.findOne({ _id: id });
    return doc ? toRule(doc) : null;
  }

  async save(rule: Rule): Promise<void> {
    await this.collection.replaceOne({ _id: rule.id }, toDocument(rule), { upsert: true });
  }

  async remove(id: string): Promise<void> {
    await this.collection.deleteOne({ _id: id });
  }
}

/** Map a stored document to a domain {@link Rule}. */
function toRule(doc: RuleDocument): Rule {
  const { _id, ...rest } = doc;
  return { id: _id, ...rest };
}

/** Map a domain {@link Rule} to its stored document. */
function toDocument(rule: Rule): RuleDocument {
  const { id, ...rest } = rule;
  return { _id: id, ...rest };
}
