import type { Rule } from '@lametrader/core';

/**
 * Stored shape of a {@link Rule} in the `rules_v2` Mongo collection,
 * keyed by id (`_id`).
 *
 * The collection literal kept its historical `_v2` suffix per issue #422
 * locked decision #2 — see {@link MongoRuleRepository}.
 */
export type RuleDocument = { _id: string } & Omit<Rule, 'id'>;
