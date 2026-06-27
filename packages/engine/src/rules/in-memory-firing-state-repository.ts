import type { FiringStateRepository } from '@lametrader/core';

/**
 * An in-memory {@link FiringStateRepository} — backs the unit tier and
 * offline/demo wiring. Holds a flat `${ruleId}|${symbolId}` → boolean map;
 * the Mongo adapter embeds the same shape on the rule document (see ADR
 * 0012), but the in-memory copy mirrors only the read/write contract since
 * the orchestrator never reaches for the rule's `firingState` field
 * directly.
 */
export class InMemoryFiringStateRepository implements FiringStateRepository {
  /** `${ruleId}|${symbolId}` → active flag. */
  private readonly active = new Map<string, boolean>();

  async getActive(ruleId: string, symbolId: string): Promise<boolean> {
    return this.active.get(`${ruleId}|${symbolId}`) ?? false;
  }

  async setActive(ruleId: string, symbolId: string, active: boolean): Promise<void> {
    this.active.set(`${ruleId}|${symbolId}`, active);
  }
}
