import type { RulesV2 } from '@lametrader/core';

/**
 * Stored shape of a v2 {@link RulesV2.Rule} in the `rules_v2` collection,
 * keyed by id (`_id`).
 *
 * Greenfield collection per ADR 0016: v1's `rules` collection is untouched
 * and the two engines coexist behind the feature flag without schema
 * entanglement.
 */
export type RuleDocumentV2 = { _id: string } & Omit<RulesV2.Rule, 'id'>;
