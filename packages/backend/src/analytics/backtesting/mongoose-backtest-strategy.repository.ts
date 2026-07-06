import type { BacktestStrategy, BacktestStrategyRepository } from '@lametrader/core';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { BacktestStrategyEntryDoc } from './backtest-strategy-entry.schema.js';

/**
 * Mongoose-backed {@link BacktestStrategyRepository}. Stores each strategy as one
 * document in the `backtest_strategies` collection, keyed by id (`_id`).
 *
 * The shared `runBacktestStrategyRepositoryContract` suite proves it is
 * behaviour-identical to the in-memory fake. `save` uses a full document
 * replacement (upsert) — whole-document semantics, like the other analytics
 * adapters.
 */
@Injectable()
export class MongooseBacktestStrategyRepository implements BacktestStrategyRepository {
  /**
   * @param model - the `backtest_strategies`-collection model injected by
   * `@nestjs/mongoose`.
   */
  constructor(
    @InjectModel(BacktestStrategyEntryDoc.name)
    private readonly model: Model<BacktestStrategyEntryDoc>,
  ) {}

  async list(): Promise<BacktestStrategy[]> {
    const docs = await this.model.find().lean().exec();
    return docs.map(toStrategy);
  }

  async get(id: string): Promise<BacktestStrategy | null> {
    const doc = await this.model.findById(id).lean().exec();
    return doc ? toStrategy(doc) : null;
  }

  async save(strategy: BacktestStrategy): Promise<void> {
    await this.model
      .replaceOne({ _id: strategy.id }, toDocument(strategy), { upsert: true })
      .exec();
  }

  async remove(id: string): Promise<void> {
    await this.model.deleteOne({ _id: id }).exec();
  }
}

/**
 * Map a stored document to a domain {@link BacktestStrategy}.
 */
function toStrategy(doc: BacktestStrategyEntryDoc): BacktestStrategy {
  return {
    id: doc._id,
    name: doc.name,
    description: doc.description,
    entry: doc.entry,
    exit: doc.exit,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Map a domain {@link BacktestStrategy} to its stored document (`_id` = id).
 */
function toDocument(strategy: BacktestStrategy): BacktestStrategyEntryDoc {
  return {
    _id: strategy.id,
    name: strategy.name,
    description: strategy.description,
    entry: strategy.entry,
    exit: strategy.exit,
    createdAt: strategy.createdAt,
    updatedAt: strategy.updatedAt,
  };
}
