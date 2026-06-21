import type { EventLog, RuleEventEntry } from '@lametrader/core';

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

  async appendRuleEvent(ruleId: string, entry: RuleEventEntry): Promise<void> {
    const events = this.ruleStore.get(ruleId);
    if (events === undefined) {
      this.ruleStore.set(ruleId, [entry]);
      return;
    }
    events.push(entry);
  }

  async appendSymbolEvent(symbolId: string, entry: RuleEventEntry): Promise<void> {
    const events = this.symbolStore.get(symbolId);
    if (events === undefined) {
      this.symbolStore.set(symbolId, [entry]);
      return;
    }
    events.push(entry);
  }

  async ruleEvents(ruleId: string): Promise<RuleEventEntry[]> {
    return [...(this.ruleStore.get(ruleId) ?? [])];
  }

  async symbolEvents(symbolId: string): Promise<RuleEventEntry[]> {
    return [...(this.symbolStore.get(symbolId) ?? [])];
  }
}
