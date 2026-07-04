import { type Candle, type CandleRepository, type Period, SymbolType } from '@lametrader/core';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { CandleEntry, type CandleKey } from './candle-entry.schema.js';

/**
 * Mongoose-backed {@link CandleRepository}. Stores each candle as one document in
 * the `candles` collection keyed by a compound `_id` of `(symbol, period, time)`,
 * which makes that tuple unique and re-saving a `time` an upsert (no duplicate).
 *
 * Replaces the native-driver `MongoCandleRepository`; the shared
 * `runCandleRepositoryContract` suite proves the swap is behaviour-identical. The
 * discriminated {@link Candle} union (crypto / equity / FX) round-trips through
 * `type` exactly as before — each asset class carries only the fields its market
 * reports.
 */
@Injectable()
export class MongooseCandleRepository implements CandleRepository {
  /**
   * @param model - the `candles`-collection model injected by `@nestjs/mongoose`.
   */
  constructor(@InjectModel(CandleEntry.name) private readonly model: Model<CandleEntry>) {}

  async save(symbolId: string, period: Period, candles: Candle[]): Promise<void> {
    if (candles.length === 0) return;
    await this.model.bulkWrite(
      candles.map((candle) => {
        const doc = toDocument(symbolId, period, candle);
        return { replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } };
      }),
    );
  }

  async range(
    symbolId: string,
    period: Period,
    from: number,
    to: number,
    limit?: number,
  ): Promise<Candle[]> {
    // Mongo's .limit(0) means "no limit" (and negatives are special-cased), so a
    // zero/negative page size must short-circuit to [] rather than scan the lot.
    if (limit !== undefined && limit <= 0) return [];
    const query = this.model
      .find({ '_id.s': symbolId, '_id.p': period, '_id.t': { $gte: from, $lt: to } })
      .sort({ '_id.t': 1 });
    if (limit !== undefined) query.limit(limit);
    const docs = await query.lean().exec();
    return docs.map(toCandle);
  }

  async latest(symbolId: string, period: Period): Promise<Candle | null> {
    const doc = await this.model
      .findOne({ '_id.s': symbolId, '_id.p': period })
      .sort({ '_id.t': -1 })
      .lean()
      .exec();
    return doc ? toCandle(doc) : null;
  }

  async latestN(
    symbolId: string,
    period: Period,
    n: number,
    before = Number.POSITIVE_INFINITY,
  ): Promise<Candle[]> {
    if (n <= 0) return [];
    const docs = await this.model
      .find(
        before === Number.POSITIVE_INFINITY
          ? { '_id.s': symbolId, '_id.p': period }
          : { '_id.s': symbolId, '_id.p': period, '_id.t': { $lt: before } },
      )
      .sort({ '_id.t': -1 })
      .limit(n)
      .lean()
      .exec();
    return docs.map(toCandle);
  }

  async deleteSymbol(symbolId: string): Promise<void> {
    await this.model.deleteMany({ '_id.s': symbolId }).exec();
  }
}

/**
 * Map a domain {@link Candle} to its stored document, keeping only the
 * per-asset-class fields the discriminant carries.
 */
function toDocument(symbolId: string, period: Period, candle: Candle): CandleEntry {
  const base: CandleEntry = {
    _id: { s: symbolId, p: period, t: candle.time },
    type: candle.type,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  };
  switch (candle.type) {
    case SymbolType.Crypto:
      return {
        ...base,
        volume: candle.volume,
        quoteVolume: candle.quoteVolume,
        trades: candle.trades,
      };
    case SymbolType.Stock:
    case SymbolType.Fund:
      return { ...base, volume: candle.volume };
    default:
      return base;
  }
}

/**
 * Map a stored document back to a domain {@link Candle}, reconstructing the
 * per-asset-class fields from its discriminant.
 */
function toCandle(doc: CandleEntry & { _id: CandleKey }): Candle {
  const base = {
    time: doc._id.t,
    open: doc.open,
    high: doc.high,
    low: doc.low,
    close: doc.close,
  };
  switch (doc.type) {
    case SymbolType.Crypto:
      return {
        ...base,
        type: SymbolType.Crypto,
        volume: doc.volume ?? 0,
        quoteVolume: doc.quoteVolume ?? 0,
        trades: doc.trades ?? 0,
      };
    case SymbolType.Stock:
    case SymbolType.Fund:
      return { ...base, type: doc.type, volume: doc.volume ?? 0 };
    default:
      return { ...base, type: SymbolType.Fx };
  }
}
