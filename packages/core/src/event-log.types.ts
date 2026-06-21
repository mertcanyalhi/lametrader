import type { RuleEventEntry } from './rule.types.js';

/**
 * Driven port for the rule-engine's embedded events log — appends each fired
 * entry to BOTH the rule's events array and the affected symbol's events
 * array (per ADR 0012).
 *
 * The two-write fan-out is not atomic — an interleaved failure may leave one
 * side missing an entry. Acceptable for an events log (occasional gaps don't
 * change correctness) and called out in the adapter.
 *
 * Implemented by driven adapters (MongoDB, in-memory).
 */
export interface EventLog {
  /**
   * Append `entry` to the rule's embedded events log.
   */
  appendRuleEvent(ruleId: string, entry: RuleEventEntry): Promise<void>;
  /**
   * Append `entry` to the affected symbol's embedded events log.
   */
  appendSymbolEvent(symbolId: string, entry: RuleEventEntry): Promise<void>;
  /**
   * Read all events recorded against a rule, in append order.
   */
  ruleEvents(ruleId: string): Promise<RuleEventEntry[]>;
  /**
   * Read all events recorded against a symbol, in append order.
   */
  symbolEvents(symbolId: string): Promise<RuleEventEntry[]>;
}
