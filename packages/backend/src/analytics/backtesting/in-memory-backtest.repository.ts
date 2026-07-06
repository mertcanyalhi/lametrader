import type { Backtest, BacktestRepository } from '@lametrader/core';

/**
 * A {@link BacktestRepository} backed by an in-memory map, keyed by id.
 *
 * Real (not a test double): backs the unit tier and the shared repository
 * contract, and is the fake substituted for the Mongoose adapter via a Nest DI
 * override in unit and integration tests.
 */
export class InMemoryBacktestRepository implements BacktestRepository {
  /** Backtests keyed by id. */
  private readonly map = new Map<string, Backtest>();

  /**
   * @param seed - backtests to pre-populate with.
   */
  constructor(seed: Backtest[] = []) {
    for (const backtest of seed) {
      this.map.set(backtest.id, backtest);
    }
  }

  async list(): Promise<Backtest[]> {
    return [...this.map.values()];
  }

  async get(id: string): Promise<Backtest | null> {
    return this.map.get(id) ?? null;
  }

  async save(backtest: Backtest): Promise<void> {
    this.map.set(backtest.id, backtest);
  }

  async remove(id: string): Promise<void> {
    this.map.delete(id);
  }
}
