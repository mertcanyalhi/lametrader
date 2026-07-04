import type {
  EventLog,
  EventLogAppendListener,
  EventLogAppendTarget,
  RuleEventEntry,
} from '@lametrader/core';
import type { Model } from 'mongoose';
import type { RuleEventDoc } from './rule-event-doc.schema.js';
import type { SymbolEventDoc } from './symbol-event-doc.schema.js';

/**
 * `@nestjs/mongoose`-backed {@link EventLog} — the rewrite of the old
 * native-driver `MongoEventLog`, behaviour-identical (proven by the shared
 * event-log contract).
 *
 * Stores rule-engine events as `$push`-appended entries on:
 *
 * - The matching `rules.{ruleId}` document's `events` array (rule events), via the
 *   {@link RuleEventDoc} model.
 * - The matching `watchlist.{symbolId}` document's `events` array (symbol events),
 *   via the {@link SymbolEventDoc} model.
 *
 * The two-write fan-out (rule + symbol) is not atomic — an interleaved failure may
 * leave one side missing an entry. Acceptable for an events log (occasional gaps
 * don't change correctness) and matches the in-memory adapter's contract
 * (ADR-0014).
 *
 * Constructed by the {@link import('./event-log.module.js').EventLogModule}
 * factory (injecting the two models + the default `Date.now` clock); the e2e
 * contract constructs it directly with a fixed clock so full-payload `firedAt`
 * assertions stay deterministic.
 */
export class MongooseEventLog implements EventLog {
  /** Wall-clock source for stamping `firedAt`; overridable for deterministic tests. */
  private readonly now: () => number;
  /** Active append listeners. */
  private readonly listeners = new Set<EventLogAppendListener>();

  /**
   * @param rules - the `rules`-collection events projection model.
   * @param symbols - the `watchlist`-collection events projection model.
   * @param now - wall-clock source; defaults to {@link Date.now}.
   */
  constructor(
    private readonly rules: Model<RuleEventDoc>,
    private readonly symbols: Model<SymbolEventDoc>,
    now: () => number = Date.now,
  ) {
    this.now = now;
  }

  async appendRuleEvent(ruleId: string, entry: RuleEventEntry): Promise<void> {
    const stamped = this.stamp(entry);
    await this.rules
      .updateOne({ _id: ruleId }, { $push: { events: stamped } }, { upsert: true })
      .exec();
    this.emit(stamped, { kind: 'rule', ruleId });
  }

  async appendSymbolEvent(symbolId: string, entry: RuleEventEntry): Promise<void> {
    const stamped = this.stamp(entry);
    await this.symbols
      .updateOne({ _id: symbolId }, { $push: { events: stamped } }, { upsert: true })
      .exec();
    this.emit(stamped, { kind: 'symbol', symbolId });
  }

  async ruleEvents(ruleId: string): Promise<RuleEventEntry[]> {
    const doc = await this.rules.findById(ruleId, { events: 1 }).lean().exec();
    return doc?.events ?? [];
  }

  async symbolEvents(symbolId: string): Promise<RuleEventEntry[]> {
    const doc = await this.symbols.findById(symbolId, { events: 1 }).lean().exec();
    return doc?.events ?? [];
  }

  async countSymbolEvents(symbolId: string): Promise<number> {
    const doc = await this.symbols.findById(symbolId, { events: 1 }).lean().exec();
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
