import type { BacktestEventQuery, BacktestEventRepository, RuleEventEntry } from '@lametrader/core';
import { windowBacktestEvents } from './backtest-event-window.js';

/**
 * A {@link BacktestEventRepository} backed by an in-memory map, keyed by
 * `backtestId`.
 *
 * Real (not a test double): backs the unit tier and the shared repository
 * contract, and is the fake substituted for the Mongoose adapter via a Nest DI
 * override in unit and integration tests. Entries are kept in append (engine
 * emission) order; {@link window} reverses to newest-first.
 */
export class InMemoryBacktestEventRepository implements BacktestEventRepository {
  /** Run events keyed by backtestId, in append order. */
  private readonly byBacktest = new Map<string, RuleEventEntry[]>();

  async append(backtestId: string, entries: RuleEventEntry[]): Promise<void> {
    const existing = this.byBacktest.get(backtestId);
    if (existing === undefined) {
      this.byBacktest.set(backtestId, [...entries]);
    } else {
      existing.push(...entries);
    }
  }

  async window(backtestId: string, query: BacktestEventQuery): Promise<RuleEventEntry[]> {
    return windowBacktestEvents(this.byBacktest.get(backtestId) ?? [], query);
  }

  async list(backtestId: string): Promise<RuleEventEntry[]> {
    return [...(this.byBacktest.get(backtestId) ?? [])];
  }

  async removeForBacktest(backtestId: string): Promise<void> {
    this.byBacktest.delete(backtestId);
  }
}
