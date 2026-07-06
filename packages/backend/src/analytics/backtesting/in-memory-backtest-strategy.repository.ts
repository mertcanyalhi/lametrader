import type { BacktestStrategy, BacktestStrategyRepository } from '@lametrader/core';

/**
 * A {@link BacktestStrategyRepository} backed by an in-memory map, keyed by id.
 *
 * Real (not a test double): backs the unit tier and the shared repository
 * contract, and is the fake substituted for the Mongoose adapter via a Nest DI
 * override in unit and integration tests.
 */
export class InMemoryBacktestStrategyRepository implements BacktestStrategyRepository {
  /**
   * Strategies keyed by id.
   */
  private readonly map = new Map<string, BacktestStrategy>();

  /**
   * @param seed - strategies to pre-populate with.
   */
  constructor(seed: BacktestStrategy[] = []) {
    for (const strategy of seed) {
      this.map.set(strategy.id, strategy);
    }
  }

  async list(): Promise<BacktestStrategy[]> {
    return [...this.map.values()];
  }

  async get(id: string): Promise<BacktestStrategy | null> {
    return this.map.get(id) ?? null;
  }

  async save(strategy: BacktestStrategy): Promise<void> {
    this.map.set(strategy.id, strategy);
  }

  async remove(id: string): Promise<void> {
    this.map.delete(id);
  }
}
