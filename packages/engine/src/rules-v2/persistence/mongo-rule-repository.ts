import { RulesV2 } from '@lametrader/core';
import type { Collection, Db, Filter } from 'mongodb';

import type { RuleV2Document } from './mongo-rule-repository.types.js';

/**
 * MongoDB-backed v2 {@link RulesV2.RuleRepository}.
 *
 * Stores each rule as a document in the `rules_v2` collection keyed by id
 * (`_id`). Greenfield collection per ADR 0016 — separate from v1's `rules`
 * so the two engines coexist behind the feature flag.
 *
 * Profile-enabled (`profile.enabled` kill-switch) filtering is deferred until
 * profiles-v2 lands; mirrors the in-memory v2 adapter and matches the issue
 * #394 scope. `profileId` filtering is honoured.
 */
export class MongoRuleRepository implements RulesV2.RuleRepository {
  /** The database handle. */
  private readonly db: Db;

  /**
   * @param db - a connected MongoDB database handle.
   */
  constructor(db: Db) {
    this.db = db;
  }

  /** The typed `rules_v2` collection. */
  private get collection(): Collection<RuleV2Document> {
    return this.db.collection<RuleV2Document>('rules_v2');
  }

  /**
   * Create the orchestrator hot-path indexes. Idempotent.
   *
   * The orchestrator hits `listEnabledForSymbol(symbolId, profileId?)` on every
   * inbound event, so the indexes prune by `enabled` + scope-id + `profileId`
   * before the in-memory scope match:
   *
   * - `{ profileId: 1, 'scope.symbolId': 1, enabled: 1 }` — Symbol-scoped reads
   *   filtered by profile.
   * - `{ enabled: 1, 'scope.symbolIds': 1 }` — Symbols-scoped reads (multikey
   *   over the symbolIds array).
   * - `{ enabled: 1, 'scope.kind': 1 }` — AllSymbols sweeps and the
   *   `listEnabledForSymbol(null)` symbol-less fan-out.
   */
  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ profileId: 1, 'scope.symbolId': 1, enabled: 1 });
    await this.collection.createIndex({ enabled: 1, 'scope.symbolIds': 1 });
    await this.collection.createIndex({ enabled: 1, 'scope.kind': 1 });
  }

  async list(): Promise<RulesV2.Rule[]> {
    const docs = await this.collection.find().toArray();
    return docs.map(toRule);
  }

  async get(id: string): Promise<RulesV2.Rule | null> {
    const doc = await this.collection.findOne({ _id: id });
    return doc ? toRule(doc) : null;
  }

  async save(rule: RulesV2.Rule): Promise<void> {
    const { id, ...fields } = rule;
    await this.collection.updateOne({ _id: id }, { $set: fields }, { upsert: true });
  }

  async remove(id: string): Promise<void> {
    await this.collection.deleteOne({ _id: id });
  }

  async listEnabledForSymbol(symbolId: string | null, profileId?: string): Promise<RulesV2.Rule[]> {
    const enabledFilter: Filter<RuleV2Document> = { enabled: true };
    const profileFilter: Filter<RuleV2Document> | null =
      profileId === undefined ? null : { profileId };
    const scopeFilter: Filter<RuleV2Document> | null =
      symbolId === null
        ? null
        : {
            $or: [
              { 'scope.kind': RulesV2.RuleScopeKind.AllSymbols },
              { 'scope.kind': RulesV2.RuleScopeKind.Symbol, 'scope.symbolId': symbolId },
              { 'scope.kind': RulesV2.RuleScopeKind.Symbols, 'scope.symbolIds': symbolId },
            ],
          };
    const clauses = [enabledFilter, profileFilter, scopeFilter].filter(
      (clause): clause is Filter<RuleV2Document> => clause !== null,
    );
    const filter: Filter<RuleV2Document> = clauses.length === 1 ? enabledFilter : { $and: clauses };
    const docs = await this.collection.find(filter).toArray();
    return docs.map(toRule);
  }
}

/**
 * Map a stored document to a domain {@link RulesV2.Rule}, dropping the
 * embedded `events` mirror used by the event log.
 */
function toRule(doc: RuleV2Document): RulesV2.Rule {
  const { _id, events: _events, ...rest } = doc;
  return { id: _id, ...rest };
}
