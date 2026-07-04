import type { RuleEventEntry } from '@lametrader/core';
import type { SymbolEventLog } from './symbol-event-log.types.js';

/**
 * A {@link SymbolEventLog} backed by an in-memory map.
 *
 * Real adapter (not a test double): backs the unit tier and doubles as the fake
 * substituted for the Mongoose adapter under a Nest DI override in tests. The
 * {@link append} helper seeds a symbol's mirrored events the way the rule
 * engine's orchestrator would.
 */
export class InMemorySymbolEventLog implements SymbolEventLog {
  /** symbolId → events appended in order. */
  private readonly store = new Map<string, RuleEventEntry[]>();

  /**
   * Append `entry` to the symbol's mirrored events log — the read side of what
   * the orchestrator writes.
   */
  append(symbolId: string, entry: RuleEventEntry): void {
    const existing = this.store.get(symbolId);
    if (existing === undefined) this.store.set(symbolId, [entry]);
    else existing.push(entry);
  }

  async symbolEvents(symbolId: string): Promise<RuleEventEntry[]> {
    return [...(this.store.get(symbolId) ?? [])];
  }
}
