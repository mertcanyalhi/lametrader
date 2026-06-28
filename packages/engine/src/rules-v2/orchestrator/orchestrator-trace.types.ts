/**
 * The terminal outcome the v2 orchestrator emits on every `rule_summary`
 * trace record — one per `(rule, firingSymbol)` evaluation, mutually
 * exclusive.
 *
 * String-valued so the JSON log line stays human-readable.
 */
export enum RuleOutcome {
  /** The rule's actions ran and the umbrella `Fired` event was appended. */
  Fired = 'fired',
  /**
   * The dispatcher decided the rule could not fire for this event — either
   * the trigger's cadence didn't route, the condition was false, or the gate
   * suppressed the fire.
   */
  DispatcherDeclined = 'dispatcher_declined',
  /** The rule was skipped because `event.ts >= rule.expiration.at`. */
  Expired = 'expired',
}
