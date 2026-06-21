import type { Rule } from '@lametrader/core';

/**
 * Stored shape of a {@link Rule} in the `rules` collection, keyed by id
 * (`_id`).
 *
 * Embedded `events` and `history` arrays live on the same document per ADR
 * 0012.
 */
export type RuleDocument = { _id: string } & Omit<Rule, 'id'>;
