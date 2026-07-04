/**
 * The terminal outcome of one rule's evaluation on one event — emitted as
 * the `outcome` field on the orchestrator's `rule_summary` trace.
 */
export enum RuleOutcome {
  /** The rule's actions ran. */
  Fired = 'fired',
  /** The rule was a candidate but skipped (condition false, gate blocked, etc.). */
  NotFired = 'notFired',
  /** The rule was past its expiration window. */
  Expired = 'expired',
  /** A cycle-limit overflow halted the rule's cascade. */
  CycleOverflow = 'cycleOverflow',
}
