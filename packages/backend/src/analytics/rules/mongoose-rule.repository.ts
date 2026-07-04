import {
  type ProfileRepository,
  type Rule,
  type RuleRepository,
  RuleScopeKind,
} from '@lametrader/core';
import type { Model, QueryFilter } from 'mongoose';
import { normalizeRule } from '../../common/domain/rules/condition-normalize.js';
import type { RuleEntry } from './rule-entry.schema.js';

/**
 * `@nestjs/mongoose`-backed {@link RuleRepository} — the rewrite of the old
 * native-driver `MongoRuleRepository`, behaviour-identical (proven by the shared
 * `runRuleRepositoryContract` suite).
 *
 * Stores each rule as a document in the `rules` collection keyed by id (`_id`).
 *
 * `listEnabledForSymbol` consults the optional injected {@link ProfileRepository}
 * to enforce the parent `profile.enabled` runtime kill-switch (ADR-0012 #5); when
 * no profile repo is provided, every profile reads as enabled.
 */
export class MongooseRuleRepository implements RuleRepository {
  /**
   * @param model - the `rules`-collection rule model.
   * @param profiles - optional profile repo consulted for the `profile.enabled`
   *   filter (omitted ⇒ every profile reads as enabled).
   */
  constructor(
    private readonly model: Model<RuleEntry>,
    private readonly profiles?: ProfileRepository,
  ) {}

  async list(): Promise<Rule[]> {
    const docs = await this.model.find().lean().exec();
    return docs.map(toRule);
  }

  async listForSymbol(symbolId: string | null, profileId?: string): Promise<Rule[]> {
    const scopeFilter: QueryFilter<RuleEntry> =
      symbolId === null
        ? { 'scope.kind': RuleScopeKind.AllSymbols }
        : {
            $or: [
              { 'scope.kind': RuleScopeKind.AllSymbols },
              { 'scope.kind': RuleScopeKind.Symbol, 'scope.symbolId': symbolId },
              { 'scope.kind': RuleScopeKind.Symbols, 'scope.symbolIds': symbolId },
            ],
          };
    const filter: QueryFilter<RuleEntry> =
      profileId === undefined ? scopeFilter : { $and: [{ profileId }, scopeFilter] };
    const docs = await this.model.find(filter).lean().exec();
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
    const doc = await this.model.findById(id).lean().exec();
    return doc ? toRule(doc) : null;
  }

  async claimOnceFire(ruleId: string): Promise<boolean> {
    // Single-document atomicity: the `{ enabled: true }` filter is part of the
    // same update, so exactly one concurrent caller matches and flips the flag;
    // every other caller (already-disabled or absent) matches nothing. `$set` on
    // one field also avoids the whole-document `replaceOne` lost-update window a
    // reload-then-save would open.
    const result = await this.model
      .findOneAndUpdate({ _id: ruleId, enabled: true }, { $set: { enabled: false } })
      .lean()
      .exec();
    return result !== null;
  }

  async save(rule: Rule): Promise<void> {
    // `$set` the rule's own fields rather than `replaceOne`-ing the whole
    // document: the event log stores its mirrored `events` array on this *same*
    // `rules` document (a second model on the collection — ADR-0014), so a full
    // replace clobbers the events a fire just pushed (the orchestrator saves the
    // rule to stamp `lastFiredAt` right after appending its fire events). `$set`
    // updates the rule fields and leaves `events` untouched; rule shapes are
    // uniform (every field always present), so it stays a full field overwrite.
    const { _id, ...fields } = toDocument(rule);
    await this.model.updateOne({ _id }, { $set: fields }, { upsert: true }).exec();
  }

  async remove(id: string): Promise<void> {
    await this.model.deleteOne({ _id: id }).exec();
  }

  async removeForProfile(profileId: string): Promise<string[]> {
    const docs = await this.model.find({ profileId }, { _id: 1 }).lean().exec();
    const ids = docs.map((doc) => doc._id);
    if (ids.length > 0) {
      await this.model.deleteMany({ profileId }).exec();
    }
    return ids;
  }

  /**
   * Apply the `profile.enabled` filter when a {@link ProfileRepository} is
   * injected; otherwise read every profile as enabled.
   */
  private async filterByEnabledProfile(rules: Rule[]): Promise<Rule[]> {
    if (this.profiles === undefined) return rules;
    // One batched read instead of one `get` per distinct profile (no N+1).
    const enabledProfileIds = new Set(
      (await this.profiles.list())
        .filter((profile) => profile.enabled)
        .map((profile) => profile.id),
    );
    return rules.filter((rule) => enabledProfileIds.has(rule.profileId));
  }
}

/**
 * Map a stored document to a domain {@link Rule}.
 *
 * Applies {@link normalizeRule} so legacy `state/Equals` / `state/NotEquals`
 * leaves over non-state-ref LHSes read back as their collapsed `comparison/Eq` /
 * `comparison/Neq` equivalents (issue #429).
 */
function toRule(doc: RuleEntry): Rule {
  const { _id, ...rest } = doc;
  return normalizeRule({ id: _id, ...rest });
}

/** Map a domain {@link Rule} to its stored document. */
function toDocument(rule: Rule): RuleEntry {
  const { id, ...rest } = rule;
  return { _id: id, ...rest };
}
