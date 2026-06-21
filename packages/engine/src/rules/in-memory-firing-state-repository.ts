import type { FiringStateRepository } from '@lametrader/core';

/**
 * An in-memory {@link FiringStateRepository} — backs the unit tier and
 * offline/demo wiring.
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
