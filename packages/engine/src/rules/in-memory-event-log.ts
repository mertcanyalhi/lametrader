import type {
  EventLog,
  EventLogAppendListener,
  EventLogAppendTarget,
  RuleEventEntry,
} from '@lametrader/core';

/**
 * An {@link EventLog} backed by in-memory maps.
 *
 * Real (not a test double): backs the unit tier and offline/demo wiring;
 * doubles as the fake the rest of the engine consumes.
 */
export class InMemoryEventLog implements EventLog {
  /** ruleId → events appended in order. */
  private readonly ruleStore = new Map<string, RuleEventEntry[]>();
  /** symbolId → events appended in order. */
  private readonly symbolStore = new Map<string, RuleEventEntry[]>();
  /** Active append listeners (mirrors `MongoStateRepository.emit`'s fan-out). */
  private readonly listeners = new Set<EventLogAppendListener>();
  /** Wall-clock source for stamping `firedAt`; overridable for deterministic tests. */
  private readonly now: () => number;

  /**
   * @param now - wall-clock source; defaults to {@link Date.now}.
   *   Tests pass a fixed clock so full-payload `toEqual` assertions stay stable.
   */
  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  async appendRuleEvent(ruleId: string, entry: RuleEventEntry): Promise<void> {
    const stamped = this.stamp(entry);
    const events = this.ruleStore.get(ruleId);
    if (events === undefined) this.ruleStore.set(ruleId, [stamped]);
    else events.push(stamped);
    this.emit(stamped, { kind: 'rule', ruleId });
  }

  async appendSymbolEvent(symbolId: string, entry: RuleEventEntry): Promise<void> {
    const stamped = this.stamp(entry);
    const events = this.symbolStore.get(symbolId);
    if (events === undefined) this.symbolStore.set(symbolId, [stamped]);
    else events.push(stamped);
    this.emit(stamped, { kind: 'symbol', symbolId });
  }

  /**
   * Stamp the entry with a persistence-time `firedAt` wall-clock if absent.
   * Preserves a caller-supplied `firedAt` (used by mirrored writes so both
   * the rule and symbol logs share the same value for one fire).
   */
  private stamp(entry: RuleEventEntry): RuleEventEntry {
    if (entry.firedAt !== undefined) return entry;
    return { ...entry, firedAt: this.now() };
  }

  async ruleEvents(ruleId: string): Promise<RuleEventEntry[]> {
    return [...(this.ruleStore.get(ruleId) ?? [])];
  }

  async symbolEvents(symbolId: string): Promise<RuleEventEntry[]> {
    return [...(this.symbolStore.get(symbolId) ?? [])];
  }

  onAppend(listener: EventLogAppendListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(entry: RuleEventEntry, target: EventLogAppendTarget): void {
    for (const listener of this.listeners) listener(entry, target);
  }
}
