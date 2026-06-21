/**
 * Stored shape of one firing-state row in the `firing_state` collection,
 * keyed by the compound `(ruleId, symbolId)` `_id`.
 */
export interface FiringStateDocument {
  _id: { ruleId: string; symbolId: string };
  active: boolean;
}
