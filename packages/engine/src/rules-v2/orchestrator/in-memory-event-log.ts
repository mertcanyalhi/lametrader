import type { RulesV2 } from '@lametrader/core';

/**
 * An {@link RulesV2.EventLog} backed by in-memory maps.
 *
 * Real adapter (not a test double): backs the unit tier and offline/demo
 * wiring; the Mongo adapter lands in #394 with the same port.
 */
export class InMemoryEventLog implements RulesV2.EventLog {
  /** ruleId → events appended in order. */
  private readonly ruleStore = new Map<string, RulesV2.RuleEventEntry[]>();
  /** symbolId → events appended in order. */
  private readonly symbolStore = new Map<string, RulesV2.RuleEventEntry[]>();
  /** Active append listeners. */
  private readonly listeners = new Set<RulesV2.EventLogAppendListener>();
  /** Wall-clock source for stamping `firedAt`; overridable for deterministic tests. */
  private readonly now: () => number;

  /**
   * @param now - wall-clock source; defaults to {@link Date.now}.
   *   Tests pass a fixed clock so full-payload `toEqual` assertions stay
   *   stable.
   */
  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  async appendRuleEvent(ruleId: string, entry: RulesV2.RuleEventEntry): Promise<void> {
    const stamped = this.stamp(entry);
    const existing = this.ruleStore.get(ruleId);
    if (existing === undefined) this.ruleStore.set(ruleId, [stamped]);
    else existing.push(stamped);
    this.emit(stamped, { kind: 'rule', ruleId });
  }

  async appendSymbolEvent(symbolId: string, entry: RulesV2.RuleEventEntry): Promise<void> {
    const stamped = this.stamp(entry);
    const existing = this.symbolStore.get(symbolId);
    if (existing === undefined) this.symbolStore.set(symbolId, [stamped]);
    else existing.push(stamped);
    this.emit(stamped, { kind: 'symbol', symbolId });
  }

  async ruleEvents(ruleId: string): Promise<RulesV2.RuleEventEntry[]> {
    return [...(this.ruleStore.get(ruleId) ?? [])];
  }

  async symbolEvents(symbolId: string): Promise<RulesV2.RuleEventEntry[]> {
    return [...(this.symbolStore.get(symbolId) ?? [])];
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
