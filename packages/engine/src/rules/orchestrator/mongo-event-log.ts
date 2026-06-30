import type {
  EventLog,
  EventLogAppendListener,
  EventLogAppendTarget,
  RuleEventEntry,
} from '@lametrader/core';
import type { Collection, Db } from 'mongodb';

/**
 * Stored shape of a rule document with its embedded events array — the only
 * fields {@link MongoEventLog} reads or writes on that collection.
 */
interface RuleDocWithEvents {
  /** Stable rule id. */
  _id: string;
  /** Embedded rule-engine events in append order. */
  events?: RuleEventEntry[];
}

/**
 * Stored shape of a `watchlist` document with its embedded rule-events
 * array.
 */
interface SymbolDocWithEvents {
  /** Canonical symbol id. */
  _id: string;
  /** Embedded rule-engine events in append order. */
  events?: RuleEventEntry[];
}

/**
 * MongoDB-backed {@link EventLog}.
 *
 * Stores rule-engine events as `$push`-appended entries on:
 *
 * - The matching `rules.{ruleId}` document's `events` array (rule events).
 * - The matching `watchlist.{symbolId}` document's `events` array (symbol
 *   events).
 *
 * The two-write fan-out (rule + symbol) is not atomic — an interleaved
 * failure may leave one side missing an entry. Acceptable for an events log
 * (occasional gaps don't change correctness) and matches the in-memory
 * adapter's contract.
 */
export class MongoEventLog implements EventLog {
  /** The database handle. */
  private readonly db: Db;
  /** Wall-clock source for stamping `firedAt`; overridable for deterministic tests. */
  private readonly now: () => number;
  /** Active append listeners. */
  private readonly listeners = new Set<EventLogAppendListener>();

  /**
   * @param db - a connected MongoDB database handle.
   * @param now - wall-clock source; defaults to {@link Date.now}.
   */
  constructor(db: Db, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
  }

  /**
   * The typed rules collection.
   */
  private get rules(): Collection<RuleDocWithEvents> {
    return this.db.collection<RuleDocWithEvents>('rules');
  }

  /**
   * The typed `watchlist` collection. Symbol-side rule events live on the
   * `events` field.
   */
  private get watchlist(): Collection<SymbolDocWithEvents> {
    return this.db.collection<SymbolDocWithEvents>('watchlist');
  }

  /**
   * Create the indexes the event-log relies on for windowed reads.
   *
   * `watchlist.events.ts` is a multikey index on the embedded symbol-side
   * events array's `ts`; `rules.events.ts` is its rule-side companion.
   *
   * The service today fetches the whole embedded array and filters in memory,
   * so the indexes don't pay off until a future `$elemMatch` push-down — but
   * having them declared up front means the migration isn't a schema-time
   * change. Idempotent: safe to call on every startup.
   */
  async ensureIndexes(): Promise<void> {
    await this.watchlist.createIndex({ 'events.ts': 1 });
    await this.rules.createIndex({ 'events.ts': 1 });
  }

  async appendRuleEvent(ruleId: string, entry: RuleEventEntry): Promise<void> {
    const stamped = this.stamp(entry);
    await this.rules.updateOne({ _id: ruleId }, { $push: { events: stamped } }, { upsert: true });
    this.emit(stamped, { kind: 'rule', ruleId });
  }

  async appendSymbolEvent(symbolId: string, entry: RuleEventEntry): Promise<void> {
    const stamped = this.stamp(entry);
    await this.watchlist.updateOne(
      { _id: symbolId },
      { $push: { events: stamped } },
      { upsert: true },
    );
    this.emit(stamped, { kind: 'symbol', symbolId });
  }

  async ruleEvents(ruleId: string): Promise<RuleEventEntry[]> {
    const doc = await this.rules.findOne({ _id: ruleId }, { projection: { events: 1 } });
    return doc?.events ?? [];
  }

  async symbolEvents(symbolId: string): Promise<RuleEventEntry[]> {
    const doc = await this.watchlist.findOne({ _id: symbolId }, { projection: { events: 1 } });
    return doc?.events ?? [];
  }

  async countSymbolEvents(symbolId: string): Promise<number> {
    const doc = await this.watchlist.findOne({ _id: symbolId }, { projection: { events: 1 } });
    return doc?.events?.length ?? 0;
  }

  onAppend(listener: EventLogAppendListener): () => void {
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
  private stamp(entry: RuleEventEntry): RuleEventEntry {
    if (entry.firedAt !== undefined) return entry;
    return { ...entry, firedAt: this.now() };
  }

  private emit(entry: RuleEventEntry, target: EventLogAppendTarget): void {
    for (const listener of this.listeners) listener(entry, target);
  }
}
