/**
 * The forensic `reason` string emitted on every `gate_decision` trace
 * record — one of a fixed vocabulary so the trace is grep-friendly and
 * downstream tooling can switch on it.
 *
 * String-valued so the JSON log line stays human-readable.
 */
export enum GateReason {
  /** The trigger gate let the rule fire. */
  Allowed = 'allowed',
  /** The `Once` gate found a prior `Fired` entry on the rule for this symbol. */
  AlreadyFired = 'already_fired',
  /** The `OncePerBar` gate found a prior `Fired` entry within the same bar. */
  SameBar = 'same_bar',
  /** The `OncePerBarClose` gate rejected a still-forming bar. */
  NotFinal = 'not_final',
  /**
   * The `OncePerMinute` gate found a prior `Fired` entry within
   * {@link OncePerMinuteTrigger.intervalMs} of the current event.
   */
  WithinInterval = 'within_interval',
  /** The `OncePerMinute` gate saw `nowActive === false` (condition not true). */
  NotActive = 'not_active',
  /**
   * The `OncePerMinute` gate saw `prevActive === true` (no false → true
   * transition, so no re-arm).
   */
  NoTransition = 'no_transition',
}

/**
 * The terminal outcome the orchestrator emits on every `rule_summary` trace
 * record — one per `(rule, firingSymbol)` evaluation, mutually exclusive.
 *
 * String-valued so the JSON log line stays human-readable.
 */
export enum RuleOutcome {
  /** The rule's actions ran and the umbrella `Fired` event was appended. */
  Fired = 'fired',
  /** The condition tree evaluated to `false`; no gate was consulted further. */
  ConditionFalse = 'condition_false',
  /** The condition was `true` but the trigger gate suppressed the fire. */
  GateBlocked = 'gate_blocked',
  /** The rule was skipped because `event.ts >= rule.expiration.at`. */
  Expired = 'expired',
}
