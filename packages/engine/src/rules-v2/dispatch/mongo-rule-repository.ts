import type { ProfileRepository } from '@lametrader/core';
import { RulesV2 } from '@lametrader/core';
import type { Collection, Db, Filter } from 'mongodb';

import type { RuleDocumentV2 } from './mongo-rule-repository.types.js';

/**
 * MongoDB-backed v2 {@link RulesV2.RuleRepository}.
 *
 * Stores each rule as a document in the `rules_v2` collection keyed by id
 * (`_id`).
 * v1's `rules` collection is untouched per ADR 0016 — the two engines
 * coexist behind the feature flag.
 *
 * `listEnabledForSymbol` consults the optional injected
 * {@link ProfileRepository} to enforce the parent `profile.enabled` runtime
 * kill-switch; when no profile repo is provided, every profile reads as
 * enabled (mirrors v1's adapter back-compat carve-out).
 */
export class MongoRuleRepository implements RulesV2.RuleRepository {
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

  /** The typed `rules_v2` collection. */
  private get collection(): Collection<RuleDocumentV2> {
    return this.db.collection<RuleDocumentV2>('rules_v2');
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

  async list(): Promise<RulesV2.Rule[]> {
    const docs = await this.collection.find().toArray();
    return docs.map(toRule);
  }

  async listForSymbol(symbolId: string | null, profileId?: string): Promise<RulesV2.Rule[]> {
    const scopeFilter: Filter<RuleDocumentV2> =
      symbolId === null
        ? { 'scope.kind': RulesV2.RuleScopeKind.AllSymbols }
        : {
            $or: [
              { 'scope.kind': RulesV2.RuleScopeKind.AllSymbols },
              { 'scope.kind': RulesV2.RuleScopeKind.Symbol, 'scope.symbolId': symbolId },
              { 'scope.kind': RulesV2.RuleScopeKind.Symbols, 'scope.symbolIds': symbolId },
            ],
          };
    const filter: Filter<RuleDocumentV2> =
      profileId === undefined ? scopeFilter : { $and: [{ profileId }, scopeFilter] };
    const docs = await this.collection.find(filter).toArray();
    return docs.map(toRule);
  }

  async listEnabledForSymbol(symbolId: string | null, profileId?: string): Promise<RulesV2.Rule[]> {
    const candidates = await this.listForSymbol(symbolId, profileId);
    const enabled = candidates.filter((rule) => rule.enabled);
    const profileFiltered = await this.filterByEnabledProfile(enabled);
    profileFiltered.sort((a, b) => a.order - b.order);
    return profileFiltered;
  }

  async get(id: string): Promise<RulesV2.Rule | null> {
    const doc = await this.collection.findOne({ _id: id });
    return doc ? toRule(doc) : null;
  }

  async save(rule: RulesV2.Rule): Promise<void> {
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
  private async filterByEnabledProfile(rules: RulesV2.Rule[]): Promise<RulesV2.Rule[]> {
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

/** Map a stored document to a domain {@link RulesV2.Rule}. */
function toRule(doc: RuleDocumentV2): RulesV2.Rule {
  const { _id, ...rest } = doc;
  return { id: _id, ...rest };
}

/** Map a domain {@link RulesV2.Rule} to its stored document. */
function toDocument(rule: RulesV2.Rule): RuleDocumentV2 {
  const { id, ...rest } = rule;
  return { _id: id, ...rest };
}
