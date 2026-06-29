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
 *
 * The field is named `events_v2` for historical reasons (the rules engine
 * landed in PR #421 alongside the legacy v1 events array on the same
 * document). The literal stays to avoid a data migration — see issue #422
 * locked decision #2.
 */
interface SymbolDocWithEvents {
  /** Canonical symbol id. */
  _id: string;
  /** Embedded rule-engine events in append order. */
  events_v2?: RuleEventEntry[];
}

/**
 * MongoDB-backed {@link EventLog}.
 *
 * Stores rule-engine events as `$push`-appended entries on:
 *
 * - The matching `rules_v2.{ruleId}` document's `events` array (rule events).
 * - The matching `watchlist.{symbolId}` document's `events_v2` array (symbol
 *   events).
 *
 * The Mongo collection name (`rules_v2`) and the watchlist field
 * (`events_v2`) both retain their historical `_v2` suffix; renaming would
 * need an operator-controlled data migration (issue #422 locked decision
 * #2). All API/CLI/web call-sites surface the engine as "rules" without
 * the suffix.
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
   * The typed rules collection. Literal name remains `rules_v2` per issue
   * #422 locked decision #2.
   */
  private get rules(): Collection<RuleDocWithEvents> {
    return this.db.collection<RuleDocWithEvents>('rules_v2');
  }

  /**
   * The typed `watchlist` collection. Symbol-side rule events live on the
   * `events_v2` field for back-compat (see class JSDoc).
   */
  private get watchlist(): Collection<SymbolDocWithEvents> {
    return this.db.collection<SymbolDocWithEvents>('watchlist');
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
      { $push: { events_v2: stamped } },
      { upsert: true },
    );
    this.emit(stamped, { kind: 'symbol', symbolId });
  }

  async ruleEvents(ruleId: string): Promise<RuleEventEntry[]> {
    const doc = await this.rules.findOne({ _id: ruleId }, { projection: { events: 1 } });
    return doc?.events ?? [];
  }

  async symbolEvents(symbolId: string): Promise<RuleEventEntry[]> {
    const doc = await this.watchlist.findOne({ _id: symbolId }, { projection: { events_v2: 1 } });
    return doc?.events_v2 ?? [];
  }

  async countSymbolEvents(symbolId: string): Promise<number> {
    const doc = await this.watchlist.findOne({ _id: symbolId }, { projection: { events_v2: 1 } });
    return doc?.events_v2?.length ?? 0;
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
