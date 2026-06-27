import type { EventLog, RuleEventEntry } from '@lametrader/core';
import type { Collection, Db } from 'mongodb';

/**
 * The shape of a `watchlist` or `rules` document with its embedded events
 * array — the only fields {@link MongoEventLog} reads or writes.
 */
interface DocumentWithEvents {
  /** Stable id (canonical symbol id for watchlist, rule id for rules). */
  _id: string;
  /** Embedded rule-engine events in append order. */
  events?: RuleEventEntry[];
}

/**
 * MongoDB-backed {@link EventLog}.
 *
 * Stores rule-engine events as `$push`-appended entries on two existing
 * collections: each fired entry is mirrored onto the parent rule's
 * `rules.{ruleId}.events` array AND the affected symbol's
 * `watchlist.{symbolId}.events` array, per ADR 0012's embedded-events
 * decision.
 *
 * The two-write fan-out is not atomic — an interleaved failure may leave
 * one side missing an entry. Acceptable for an events log (occasional gaps
 * don't change correctness) and matches the in-memory adapter's contract.
 */
export class MongoEventLog implements EventLog {
  /** The database handle. */
  private readonly db: Db;

  /**
   * @param db - a connected MongoDB database handle.
   */
  constructor(db: Db) {
    this.db = db;
  }

  /** The typed `watchlist` collection. */
  private get watchlist(): Collection<DocumentWithEvents> {
    return this.db.collection<DocumentWithEvents>('watchlist');
  }

  /** The typed `rules` collection. */
  private get rules(): Collection<DocumentWithEvents> {
    return this.db.collection<DocumentWithEvents>('rules');
  }

  async appendRuleEvent(ruleId: string, entry: RuleEventEntry): Promise<void> {
    await this.rules.updateOne({ _id: ruleId }, { $push: { events: entry } });
  }

  async appendSymbolEvent(symbolId: string, entry: RuleEventEntry): Promise<void> {
    await this.watchlist.updateOne({ _id: symbolId }, { $push: { events: entry } });
  }

  async ruleEvents(ruleId: string): Promise<RuleEventEntry[]> {
    const doc = await this.rules.findOne({ _id: ruleId }, { projection: { events: 1 } });
    return doc?.events ?? [];
  }

  async symbolEvents(symbolId: string): Promise<RuleEventEntry[]> {
    const doc = await this.watchlist.findOne({ _id: symbolId }, { projection: { events: 1 } });
    return doc?.events ?? [];
  }
}
