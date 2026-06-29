import type { ProfileRepository } from '@lametrader/core';
import { normalizeRule, type Rule, type RuleRepository, RuleScopeKind } from '@lametrader/core';
import type { Collection, Db, Filter } from 'mongodb';

import type { RuleDocument } from './mongo-rule-repository.types.js';

/**
 * MongoDB-backed {@link RuleRepository}.
 *
 * Stores each rule as a document in the `rules_v2` collection keyed by id
 * (`_id`).
 *
 * The collection name retains its historical `rules_v2` literal even after
 * the engine-side rename in issue #422 (locked decision #2: the rename
 * requires an operator-controlled data migration, tracked separately and
 * scoped out of the code-only refactor).
 *
 * `listEnabledForSymbol` consults the optional injected
 * {@link ProfileRepository} to enforce the parent `profile.enabled` runtime
 * kill-switch; when no profile repo is provided, every profile reads as
 * enabled.
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

  /**
   * The typed Mongo collection backing the rules engine.
   *
   * The literal name remains `rules_v2` for back-compat (see the class-level
   * JSDoc and issue #422 locked decision #2).
   */
  private get collection(): Collection<RuleDocument> {
    return this.db.collection<RuleDocument>('rules_v2');
  }

  /**
   * Create the indexes the orchestrator's hot path needs.
   * Idempotent — running it twice is safe.
   *
   * - `{ profileId: 1, order: 1 }` — supports per-profile reads sorted by
   *   `order` (the dispatcher's iteration order).
   * - `{ 'scope.symbolId': 1 }` — supports the `Symbol`-scope lookups
   *   `listForSymbol` issues.
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
              { 'scope.kind': RuleScopeKind.Symbols, 'scope.symbolIds': symbolId },
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
    const profileFiltered = await this.filterByEnabledProfile(enabled);
    profileFiltered.sort((a, b) => a.order - b.order);
    return profileFiltered;
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

  /**
   * Apply the `profile.enabled` filter when a {@link ProfileRepository} is
   * injected; otherwise read every profile as enabled.
   */
  private async filterByEnabledProfile(rules: Rule[]): Promise<Rule[]> {
    if (this.profiles === undefined) return rules;
    const profileIds = [...new Set(rules.map((rule) => rule.profileId))];
    const enabledProfileIds = new Set<string>();
    for (const id of profileIds) {
      const profile = await this.profiles.get(id);
      if (profile?.enabled === true) enabledProfileIds.add(id);
    }
    return rules.filter((rule) => enabledProfileIds.has(rule.profileId));
  }
}

/**
 * Map a stored document to a domain {@link Rule}.
 *
 * Applies {@link normalizeRule} so legacy `state/Equals` / `state/NotEquals`
 * leaves over non-state-ref LHSes read back as their collapsed
 * `comparison/Eq` / `comparison/Neq` equivalents (issue #429).
 */
function toRule(doc: RuleDocument): Rule {
  const { _id, ...rest } = doc;
  return normalizeRule({ id: _id, ...rest });
}

/** Map a domain {@link Rule} to its stored document. */
function toDocument(rule: Rule): RuleDocument {
  const { id, ...rest } = rule;
  return { _id: id, ...rest };
}
