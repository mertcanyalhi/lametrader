import type { RulesV2 } from '@lametrader/core';
import type { Collection, Db } from 'mongodb';

/**
 * Stored shape of a `rules_v2` document with its embedded events array — the
 * only fields {@link MongoEventLog} reads or writes on that collection.
 */
interface RuleDocWithEvents {
  /** Stable rule id. */
  _id: string;
  /** Embedded v2 rule-engine events in append order. */
  events?: RulesV2.RuleEventEntry[];
}

/**
 * Stored shape of a `watchlist` document with its v2 embedded events array.
 * The `events_v2` field is parallel to v1's `events` field on the same
 * document, so v2 writes never overwrite v1's symbol-event log.
 */
interface SymbolDocWithEventsV2 {
  /** Canonical symbol id. */
  _id: string;
  /** Embedded v2 rule-engine events in append order. */
  events_v2?: RulesV2.RuleEventEntry[];
}

/**
 * MongoDB-backed v2 {@link RulesV2.EventLog}.
 *
 * Stores rule-engine events as `$push`-appended entries on:
 *
 * - The matching `rules_v2.{ruleId}` document's `events` array (rule events).
 * - The matching `watchlist.{symbolId}` document's `events_v2` array (symbol
 *   events).
 *
 * `events_v2` is a brand-new field on the watchlist document, parallel to v1's
 * `events` array — the two engines can run side-by-side on one Mongo instance
 * without overwriting each other's symbol-event log (per ADR 0016).
 *
 * The two-write fan-out (rule + symbol) is not atomic — an interleaved failure
 * may leave one side missing an entry.
 * Acceptable for an events log (occasional gaps don't change correctness) and
 * matches the in-memory adapter's contract.
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

  /** The typed `rules_v2` collection. */
  private get rules(): Collection<RuleDocWithEvents> {
    return this.db.collection<RuleDocWithEvents>('rules_v2');
  }

  /** The typed `watchlist` collection (v2 uses the `events_v2` field). */
  private get watchlist(): Collection<SymbolDocWithEventsV2> {
    return this.db.collection<SymbolDocWithEventsV2>('watchlist');
  }

  async appendRuleEvent(ruleId: string, entry: RulesV2.RuleEventEntry): Promise<void> {
    const stamped = this.stamp(entry);
    await this.rules.updateOne({ _id: ruleId }, { $push: { events: stamped } }, { upsert: true });
    this.emit(stamped, { kind: 'rule', ruleId });
  }

  async appendSymbolEvent(symbolId: string, entry: RulesV2.RuleEventEntry): Promise<void> {
    const stamped = this.stamp(entry);
    await this.watchlist.updateOne(
      { _id: symbolId },
      { $push: { events_v2: stamped } },
      { upsert: true },
    );
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
   * can share one stamp per fire.
   */
  private stamp(entry: RulesV2.RuleEventEntry): RulesV2.RuleEventEntry {
    if (entry.firedAt !== undefined) return entry;
    return { ...entry, firedAt: this.now() };
  }

  private emit(entry: RulesV2.RuleEventEntry, target: RulesV2.EventLogAppendTarget): void {
    for (const listener of this.listeners) listener(entry, target);
  }
}
