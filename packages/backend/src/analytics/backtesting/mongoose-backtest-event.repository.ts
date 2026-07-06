import type { BacktestEventQuery, BacktestEventRepository, RuleEventEntry } from '@lametrader/core';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { BacktestEventDoc } from './backtest-event.schema.js';
import { windowBacktestEvents } from './backtest-event-window.js';

/**
 * Mongoose-backed {@link BacktestEventRepository}. Stores each run event as one
 * document in the `backtest_events` collection, tagged with its `backtestId` and
 * a monotonic per-backtest `seq` so the engine's emission order is preserved for
 * the newest-first window read.
 *
 * The shared `runBacktestEventRepositoryContract` suite proves it is
 * behaviour-identical to the in-memory fake. Cascade delete is a bulk
 * `deleteMany` on `backtestId`.
 */
@Injectable()
export class MongooseBacktestEventRepository implements BacktestEventRepository {
  /**
   * @param model - the `backtest_events`-collection model injected by `@nestjs/mongoose`.
   */
  constructor(
    @InjectModel(BacktestEventDoc.name)
    private readonly model: Model<BacktestEventDoc>,
  ) {}

  async append(backtestId: string, entries: RuleEventEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const existing = await this.model.countDocuments({ backtestId }).exec();
    const docs = entries.map((entry, index) => ({ backtestId, seq: existing + index, entry }));
    await this.model.insertMany(docs);
  }

  async window(backtestId: string, query: BacktestEventQuery): Promise<RuleEventEntry[]> {
    const entries = await this.ordered(backtestId);
    return windowBacktestEvents(entries, query);
  }

  async list(backtestId: string): Promise<RuleEventEntry[]> {
    return this.ordered(backtestId);
  }

  async removeForBacktest(backtestId: string): Promise<void> {
    await this.model.deleteMany({ backtestId }).exec();
  }

  /** Read a backtest's events in append (seq) order. */
  private async ordered(backtestId: string): Promise<RuleEventEntry[]> {
    const docs = await this.model.find({ backtestId }).sort({ seq: 1 }).lean().exec();
    return docs.map((doc) => doc.entry);
  }
}
