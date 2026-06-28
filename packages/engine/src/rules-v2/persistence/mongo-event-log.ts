import type { RulesV2 } from '@lametrader/core';
import type { Collection, Db } from 'mongodb';

/**
 * Shape of a `rules_v2` document with its embedded v2 events array — the only
 * fields {@link MongoEventLog} reads or writes on the rule side.
 */
interface RuleDocumentWithEvents {
  /** The rule's id. */
  _id: string;
  /** Embedded v2 rule-engine events in append order. */
  events?: RulesV2.RuleEventEntry[];
}

/**
 * Shape of a `watchlist` document with its embedded v2 events array — the
 * only fields {@link MongoEventLog} reads or writes on the symbol side.
 *
 * Lives under the new `events_v2` field so v1's `events` array on the same
 * watchlist document is untouched (per #394 — v1 and v2 coexist).
 */
interface SymbolDocumentWithEventsV2 {
  /** The watched symbol id. */
  _id: string;
  /** Embedded v2 rule-engine events in append order, parallel to v1's `events`. */
  events_v2?: RulesV2.RuleEventEntry[];
}

/**
 * MongoDB-backed v2 {@link RulesV2.EventLog}.
 *
 * Mirrors the v1 design (ADR 0012) inside the v2 namespace: each fired entry
 * is `$push`-appended onto the parent rule's `rules_v2.{ruleId}.events` array
 * AND the affected symbol's `watchlist.{symbolId}.events_v2` array.
 *
 * The two-write fan-out is not atomic — an interleaved failure may leave one
 * side missing an entry. Acceptable for an events log (occasional gaps don't
 * change correctness) and matches the in-memory adapter's contract.
 *
 * The symbol-side write lands on the existing `watchlist` collection but under
 * the new `events_v2` field, so v1's `events` array is never touched and the
 * two engines coexist behind the feature flag.
 */
export class MongoEventLog implements RulesV2.EventLog {
  /** The database handle. */
  private readonly db: Db;
  /** Wall-clock source for stamping `firedAt`; overridable for deterministic tests. */
  private readonly now: () => number;
  /** Active append listeners. */
  private readonly listeners = new Set<RulesV2.EventLogAppendListener>();

  /**
   * @param db - a connected MongoDB database handle.
   * @param now - wall-clock source; defaults to {@link Date.now}.
   */
  constructor(db: Db, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
  }

  /** The typed `rules_v2` collection (rule-side embedded events array). */
  private get rules(): Collection<RuleDocumentWithEvents> {
    return this.db.collection<RuleDocumentWithEvents>('rules_v2');
  }

  /** The typed `watchlist` collection (symbol-side `events_v2` array). */
  private get watchlist(): Collection<SymbolDocumentWithEventsV2> {
    return this.db.collection<SymbolDocumentWithEventsV2>('watchlist');
  }

  async appendRuleEvent(ruleId: string, entry: RulesV2.RuleEventEntry): Promise<void> {
    const stamped = this.stamp(entry);
    await this.rules.updateOne({ _id: ruleId }, { $push: { events: stamped } });
    this.emit(stamped, { kind: 'rule', ruleId });
  }

  async appendSymbolEvent(symbolId: string, entry: RulesV2.RuleEventEntry): Promise<void> {
    const stamped = this.stamp(entry);
    await this.watchlist.updateOne({ _id: symbolId }, { $push: { events_v2: stamped } });
    this.emit(stamped, { kind: 'symbol', symbolId });
  }

  async ruleEvents(ruleId: string): Promise<RulesV2.RuleEventEntry[]> {
    const doc = await this.rules.findOne({ _id: ruleId }, { projection: { events: 1 } });
    return doc?.events ?? [];
  }

  async symbolEvents(symbolId: string): Promise<RulesV2.RuleEventEntry[]> {
    const doc = await this.watchlist.findOne({ _id: symbolId }, { projection: { events_v2: 1 } });
    return doc?.events_v2 ?? [];
  }

  onAppend(listener: RulesV2.EventLogAppendListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Stamp the entry with a persistence-time `firedAt` wall-clock if absent.
   * Preserves a caller-supplied `firedAt` so mirrored writes (rule + symbol)
   * share the same value for one fire.
   */
  private stamp(entry: RulesV2.RuleEventEntry): RulesV2.RuleEventEntry {
    if (entry.firedAt !== undefined) return entry;
    return { ...entry, firedAt: this.now() };
  }

  /** Notify every active listener of a successful append. */
  private emit(entry: RulesV2.RuleEventEntry, target: RulesV2.EventLogAppendTarget): void {
    for (const listener of this.listeners) listener(entry, target);
  }
}
