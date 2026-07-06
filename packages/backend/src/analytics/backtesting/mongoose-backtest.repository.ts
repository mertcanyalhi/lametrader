import type { Backtest, BacktestRepository } from '@lametrader/core';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { BacktestDoc } from './backtest.schema.js';

/**
 * Mongoose-backed {@link BacktestRepository}. Stores each completed backtest as
 * one document in the `backtests` collection, keyed by id (`_id`).
 *
 * The shared `runBacktestRepositoryContract` suite proves it is
 * behaviour-identical to the in-memory fake. `save` uses a full document
 * replacement (upsert) — whole-document semantics, like the other analytics
 * adapters.
 */
@Injectable()
export class MongooseBacktestRepository implements BacktestRepository {
  /**
   * @param model - the `backtests`-collection model injected by `@nestjs/mongoose`.
   */
  constructor(
    @InjectModel(BacktestDoc.name)
    private readonly model: Model<BacktestDoc>,
  ) {}

  async list(): Promise<Backtest[]> {
    const docs = await this.model.find().lean().exec();
    return docs.map(toBacktest);
  }

  async get(id: string): Promise<Backtest | null> {
    const doc = await this.model.findById(id).lean().exec();
    return doc ? toBacktest(doc) : null;
  }

  async save(backtest: Backtest): Promise<void> {
    await this.model
      .replaceOne({ _id: backtest.id }, toDocument(backtest), { upsert: true })
      .exec();
  }

  async remove(id: string): Promise<void> {
    await this.model.deleteOne({ _id: id }).exec();
  }
}

/**
 * Map a stored document to a domain {@link Backtest}, dropping the optional
 * `openPosition` key entirely when the run held no open position (rather than
 * carrying an explicit `undefined`, which a full-payload `toEqual` would reject).
 */
function toBacktest(doc: BacktestDoc): Backtest {
  const base: Backtest = {
    id: doc._id,
    name: doc.name,
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    params: doc.params,
    strategyId: doc.strategyId,
    strategy: doc.strategy,
    trades: doc.trades,
    summary: doc.summary,
  };
  return doc.openPosition === undefined ? base : { ...base, openPosition: doc.openPosition };
}

/**
 * Map a domain {@link Backtest} to its stored document (`_id` = id).
 */
function toDocument(backtest: Backtest): BacktestDoc {
  return {
    _id: backtest.id,
    name: backtest.name,
    status: backtest.status,
    createdAt: backtest.createdAt,
    updatedAt: backtest.updatedAt,
    params: backtest.params,
    strategyId: backtest.strategyId,
    strategy: backtest.strategy,
    trades: backtest.trades,
    ...(backtest.openPosition === undefined ? {} : { openPosition: backtest.openPosition }),
    summary: backtest.summary,
  };
}
