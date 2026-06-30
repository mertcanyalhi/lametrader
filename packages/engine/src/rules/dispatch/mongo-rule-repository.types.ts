import type { Rule } from '@lametrader/core';

/**
 * Stored shape of a {@link Rule} in the `rules` Mongo collection,
 * keyed by id (`_id`).
 */
export type RuleDocument = { _id: string } & Omit<Rule, 'id'>;
