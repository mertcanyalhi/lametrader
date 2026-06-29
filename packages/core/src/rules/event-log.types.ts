import type { RuleEventEntry } from './rule-event-entry.types.js';

/**
 * Which side of a successful append an {@link EventLogAppendListener} is
 * notified about — either the rule's events array or the affected symbol's
 * events array.
 *
 * The two append methods on {@link EventLog} are called once each per fire,
 * so a listener is invoked once per side with the same stamped entry and a
 * different `target`.
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
 * Driven port for the v2 rule-engine's events log — appends each entry to
 * BOTH the rule's array and the affected symbol's array.
 *
 * Mirrors v1's `EventLog` port but lives in the `types` re-exported at the @lametrader/core package root and
 * carries the v2 {@link RuleEventEntry} tagged union (per ADR 0016).
 *
 * The two-write fan-out is not atomic — an interleaved failure may leave one
 * side missing an entry. Acceptable for an events log (occasional gaps don't
 * change correctness).
 *
 * Implemented by driven adapters (MongoDB in #394 and an in-memory adapter
 * that backs the unit tier).
 */
export interface EventLog {
  /**
   * Append `entry` to the rule's events log; the adapter stamps `firedAt`
   * if absent.
   */
  appendRuleEvent(ruleId: string, entry: RuleEventEntry): Promise<void>;
  /**
   * Append `entry` to the affected symbol's events log; the adapter stamps
   * `firedAt` if absent.
   */
  appendSymbolEvent(symbolId: string, entry: RuleEventEntry): Promise<void>;
  /** Read all events recorded against a rule, in append order. */
  ruleEvents(ruleId: string): Promise<RuleEventEntry[]>;
  /** Read all events recorded against a symbol, in append order. */
  symbolEvents(symbolId: string): Promise<RuleEventEntry[]>;
  /**
   * Subscribe to every successful append; returns an unsubscribe.
   *
   * The listener is invoked AFTER the underlying write succeeds, with the
   * stamped `entry` and a discriminated `target`. Each fire mirrors to two
   * appends (rule + symbol), so the listener is invoked twice per fire with
   * the same entry and different `target.kind`.
   */
  onAppend(listener: EventLogAppendListener): () => void;
}
