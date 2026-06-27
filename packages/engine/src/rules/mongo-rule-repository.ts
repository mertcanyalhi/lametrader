import {
  type ProfileRepository,
  type Rule,
  type RuleRepository,
  RuleScopeKind,
} from '@lametrader/core';
import type { Collection, Db, Filter } from 'mongodb';
import type { RuleDocument } from './mongo-rule-repository.types.js';

/**
 * MongoDB-backed {@link RuleRepository}.
 *
 * Stores each rule as a document in the `rules` collection keyed by id
 * (`_id`). Embedded `events` and `history` arrays live on the same document
 * per ADR 0012.
 *
 * `listEnabledForSymbol` consults the optional injected
 * {@link ProfileRepository} to enforce the parent `profile.enabled` runtime
 * kill-switch (#290); when no profile repo is provided, every profile reads
 * as enabled.
 */
export class MongoRuleRepository implements RuleRepository {
  /** The database handle. */
  private readonly db: Db;
  /** Optional profile repo consulted for the `profile.enabled` filter. */
  private readonly profiles: ProfileRepository | undefined;

  /**
   * @param db - a connected MongoDB database handle.
   * @param profiles - optional profile repo for the `profile.enabled` filter.
   */
  constructor(db: Db, profiles?: ProfileRepository) {
    this.db = db;
    this.profiles = profiles;
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

  async listForSymbol(symbolId: string | null, profileId?: string): Promise<Rule[]> {
    const scopeFilter: Filter<RuleDocument> =
      symbolId === null
        ? { 'scope.kind': RuleScopeKind.AllSymbols }
        : {
            $or: [
              { 'scope.kind': RuleScopeKind.AllSymbols },
              { 'scope.kind': RuleScopeKind.Symbol, 'scope.symbolId': symbolId },
            ],
          };
    const filter: Filter<RuleDocument> =
      profileId === undefined ? scopeFilter : { $and: [{ profileId }, scopeFilter] };
    const docs = await this.collection.find(filter).toArray();
    return docs.map(toRule);
  }

  async listEnabledForSymbol(symbolId: string | null, profileId?: string): Promise<Rule[]> {
    const candidates = await this.listForSymbol(symbolId, profileId);
    const enabled = candidates.filter((rule) => rule.enabled);
    if (this.profiles === undefined) return enabled;
    const profileIds = [...new Set(enabled.map((rule) => rule.profileId))];
    const enabledProfileIds = new Set<string>();
    for (const id of profileIds) {
      const profile = await this.profiles.get(id);
      if (profile?.enabled === true) enabledProfileIds.add(id);
    }
    return enabled.filter((rule) => enabledProfileIds.has(rule.profileId));
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

  async removeForProfile(profileId: string): Promise<string[]> {
    const docs = await this.collection.find({ profileId }, { projection: { _id: 1 } }).toArray();
    const ids = docs.map((doc) => doc._id);
    if (ids.length > 0) {
      await this.collection.deleteMany({ profileId });
    }
    return ids;
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
