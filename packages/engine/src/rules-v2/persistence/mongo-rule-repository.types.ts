import type { RulesV2 } from '@lametrader/core';

/**
 * Stored shape of a v2 {@link RulesV2.Rule} in the `rules_v2` collection,
 * keyed by id (`_id`).
 *
 * Greenfield collection per ADR 0016 — separate from v1's `rules` so the two
 * engines coexist behind the feature flag.
 *
 * The embedded `events` array is the v2 event-log's per-rule mirror,
 * populated by {@link MongoEventLog.appendRuleEvent}.
 */
export type RuleV2Document = { _id: string; events?: RulesV2.RuleEventEntry[] } & Omit<
  RulesV2.Rule,
  'id'
>;
