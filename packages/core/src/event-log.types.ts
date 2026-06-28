import type { RuleEventEntry } from './rule.types.js';

/**
 * Which side of a successful append an {@link EventLogAppendListener} is
 * notified about — either the rule's events array or the affected symbol's
 * events array.
 *
 * The two append methods on {@link EventLog} are non-atomic and called once
 * each per fire, so a listener is invoked once per side with the same stamped
 * entry and a different `target`.
 */
export type EventLogAppendTarget =
  | { kind: 'rule'; ruleId: string }
  | { kind: 'symbol'; symbolId: string };

/**
 * Subscriber for {@link EventLog.onAppend} — receives the stamped `entry`
 * (with `firedAt` resolved) and the {@link EventLogAppendTarget} that was
 * written to.
 */
export type EventLogAppendListener = (entry: RuleEventEntry, target: EventLogAppendTarget) => void;

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
  /**
   * Subscribe to every successful append; returns an unsubscribe.
   *
   * The listener is invoked AFTER the underlying write succeeds, with the
   * stamped `entry` (so `firedAt` is set) and a discriminated `target`. Each
   * fire mirrors to two appends (rule + symbol), so the listener is invoked
   * twice per fire with the same entry and different `target.kind` — by
   * design; callers filter to the side they care about.
   */
  onAppend(listener: EventLogAppendListener): () => void;
}
